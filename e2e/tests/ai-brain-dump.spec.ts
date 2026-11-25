import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// ADR-020. The browser tests run against a scripted stand-in model (one task per sentence), so the
// flow is tested without a network call or cost; the real model call is covered by the API tests'
// contract and the server's checks of whatever comes back.
test("writing freely turns a paragraph into suggested lines the person checks before saving", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Brain dump", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radiogroup", { name: "How to write" }).getByRole("radio", { name: "Write freely" }).check();
  await dialog.getByLabel("Write everything on your mind").fill("Finish the important deck for Monday. Book the dentist.");
  await expect(dialog).toContainText("left today");
  await dialog.getByRole("button", { name: "Turn into tasks" }).click();

  // Suggestions arrive as ordinary lines, with details filled in, and nothing is saved yet.
  await expect(dialog.locator(".dump-row .plan-title")).toHaveCount(2);
  await expect(dialog.locator(".dump-row .plan-title").first()).toHaveValue("Finish the important deck for Monday");
  const deck = dialog.getByRole("group", { name: "Options for Finish the important deck for Monday" });
  await expect(deck.getByRole("button", { name: "Kind of work: Deep focus" })).toBeVisible();
  await expect(deck.getByRole("button", { name: "Outcome impact: High impact" })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Options for Book the dentist" }).getByRole("button", { name: "Outside work" })).toHaveAttribute("aria-pressed", "true");

  // The person can drop a suggestion before saving.
  await dialog.getByRole("button", { name: "Remove Book the dentist" }).click();
  await dialog.getByRole("button", { name: "Save to backlog" }).click();
  await expect(page.getByText("1 task added to your backlog")).toBeVisible();
  await page.goto("/backlog?view=list");
  await expect(page.getByRole("button", { name: "Finish the important deck for Monday", exact: true })).toBeVisible();
  await expect(page.getByText("Book the dentist")).toHaveCount(0);
});
