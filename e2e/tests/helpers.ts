import { expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAIL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".mail");
export const PASSWORD = "correct horse battery";

/** The newest email the app "sent" to an address, as plain text. */
export async function latestEmail(to: string, subjectStartsWith: string): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      () => {
        if (!fs.existsSync(MAIL_DIR)) return false;
        found = fs
          .readdirSync(MAIL_DIR)
          .sort()
          .reverse()
          .map((file) => fs.readFileSync(path.join(MAIL_DIR, file), "utf8"))
          .find((text) => text.startsWith(`To: ${to}\nSubject: ${subjectStartsWith}`));
        return !!found;
      },
      { message: `an email "${subjectStartsWith}…" for ${to}`, timeout: 10_000 },
    )
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

/** The current 6-digit code for an authenticator secret (RFC 6238), as a phone app would show it. */
export function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32Secret.replace(/[\s=]/g, "").toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/**
 * Moves the server's clock forward, as if that much time had really passed, then brings the page
 * back into focus so it re-syncs with the server (the app trusts the server's clock, not the device's).
 */
export async function advanceTime(page: Page, minutes: number) {
  const response = await page.request.post("/api/testing/clock/advance", {
    data: { seconds: Math.round(minutes * 60) },
    headers: { "X-MB-Client": "tests", "X-CSRF-TOKEN": await csrf(page) },
  });
  expect(response.ok()).toBeTruthy();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
}

async function csrf(page: Page): Promise<string> {
  return ((await (await page.request.get("/api/auth/csrf")).json()) as { token: string }).token;
}
