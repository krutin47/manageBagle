import { expect, test } from "@playwright/test";
import { latestEmail, linkIn, PASSWORD, signIn, signUp } from "./helpers";

test("an account cannot be used before its email is confirmed, and a new link can be requested", async ({ page }) => {
  const email = `e2e-pending-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Pending Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await signIn(page, email);
  await expect(page.getByRole("alert")).toContainText("Confirm your email address first");
  await page.getByRole("button", { name: "Send me a new confirmation link" }).click();
  await expect(page.getByRole("status")).toContainText("new confirmation link");

  const link = linkIn(await latestEmail(email, "Confirm"));
  await page.goto(link.pathname + link.search);
  await expect(page).toHaveURL(/\/guide/);
  await expect(page.getByText("Welcome, Pending.")).toBeVisible();
});

test("signing in with the wrong password explains itself, and signing out ends the session", async ({ page }) => {
  const email = await signUp(page);
  await page.getByRole("button", { name: /Riley Tester/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  // A protected page sends a signed-out visitor to sign in, then back to where they were going.
  await page.goto("/backlog");
  await expect(page).toHaveURL(/\/login\?next=%2Fbacklog/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("do not match");

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/backlog/);
});

test("the account's time zone is taken from the device at sign-up and can be changed", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings");
  await expect(page.getByLabel("Time zone")).toHaveValue("America/Halifax");
  await page.getByLabel("Time zone").selectOption("Europe/London");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile saved" })).toBeVisible();

  // The device is still in Halifax, so the app asks rather than silently switching back.
  await page.goto("/");
  await expect(page.getByText("You seem to be in America/Halifax.")).toBeVisible();
  await page.getByRole("button", { name: "Keep London time" }).click();
  await expect(page.getByText("You seem to be in America/Halifax.")).toHaveCount(0);
});
