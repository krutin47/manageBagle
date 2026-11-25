import { expect, test } from "@playwright/test";
import { latestEmail, linkIn, PASSWORD, signIn, signUp, totp } from "./helpers";

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

test("someone who lost their authenticator and recovery codes can recover by email and see it in their activity", async ({ page }) => {
  const email = await signUp(page, "Morgan Locked");

  // Turn on two-step verification through Settings, as a person would.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.locator(".mfa-key")).toHaveText(/^[A-Z2-7 ]{16,}$/);
  const secret = (await page.locator(".mfa-key").innerText()).replace(/\s/g, "");
  await page.getByLabel("Authentication code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify and turn on" }).click();
  await page.getByRole("button", { name: "I have saved them" }).click();

  // The phone and the codes are gone. Sign in with the password only.
  await page.getByRole("button", { name: /Morgan Locked/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/login\/verify/);
  await page.getByRole("button", { name: "Lost your phone? Use a recovery code" }).click();
  await page.getByRole("button", { name: "Start account recovery" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();

  const link = linkIn(await latestEmail(email, "Turn off two-step"));
  await page.goto(link.pathname + link.search);
  await expect(page.getByRole("heading", { name: "Recovery confirmed" })).toBeVisible();

  // After the waiting period (zero in this test environment) the password finishes it.
  await signIn(page, email);
  await page.getByRole("button", { name: "Lost your phone? Use a recovery code" }).click();
  await page.getByRole("button", { name: "Turn off two-step verification and sign in" }).click();
  await expect(page).toHaveURL("/");
  await expect(async () => expect(await latestEmail(email, "Two-step verification was turned off")).toBeTruthy()).toPass();

  await page.goto("/settings");
  const activity = page.getByRole("region", { name: "Account activity" });
  await expect(activity).toContainText("Two-step verification turned off by recovery");
  await expect(activity).toContainText("Recovery confirmed by email");
});
