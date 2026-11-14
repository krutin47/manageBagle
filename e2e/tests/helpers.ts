import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAIL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".mail");
export const PASSWORD = "correct horse battery";

/** The newest email the app "sent" to an address, as plain text. */
export async function latestEmail(to: string, subjectStartsWith: string): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(() => {
      if (!fs.existsSync(MAIL_DIR)) return false;
      found = fs.readdirSync(MAIL_DIR).sort().reverse()
        .map((file) => fs.readFileSync(path.join(MAIL_DIR, file), "utf8"))
        .find((text) => text.startsWith(`To: ${to}\nSubject: ${subjectStartsWith}`));
      return !!found;
    }, { message: `an email "${subjectStartsWith}…" for ${to}`, timeout: 10_000 })
    .toBe(true);
  return found!;
}

export const linkIn = (email: string) => new URL(email.match(/https?:\/\/\S+/)![0]);

/** Registers a new person the way a person would: form, then the link in their inbox. Ends signed in. */
export async function signUp(page: Page, name = "Riley Tester"): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const link = linkIn(await latestEmail(email, "Confirm"));
  await page.goto(link.pathname + link.search);
  await expect(page).toHaveURL(/\/guide/);
  return email;
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A date in the page's own idea of "today" plus N days, as YYYY-MM-DD. */
export async function dayFromToday(page: Page, offset: number): Promise<string> {
  return page.evaluate((days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, offset);
}
