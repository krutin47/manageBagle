import { expect, test } from "@playwright/test";
import { dayFromToday, signUp } from "./helpers";

// P2-G1: whatever happens to a task on Today shows in the right column of the board.
test("starting, putting off and dropping on Today move the cards on the board", async ({ page }) => {
  await signUp(page);
  const tomorrow = await dayFromToday(page, 1);
  await page.goto(`/?date=${tomorrow}`);
  await page.getByRole("button", { name: "Plan my day" }).click();
  const box = page.getByLabel("Add a new task to this plan");
  for (const t of ["Started task", "Later task", "Dropped task"]) { await box.fill(t); await box.press("Enter"); }
  await page.getByRole("button", { name: /Next: top three/ }).click();
  await page.getByRole("button", { name: /Next: fit into the day/ }).click();
  await page.getByRole("button", { name: "Yes, add them all" }).click();

  const schedule = page.getByRole("region", { name: "Schedule" });
  const menu = async (title: string) => schedule.locator(".agenda-row", { hasText: title }).getByRole("button", { name: /Change status/ }).click();

  await menu("Started task");
  await page.getByRole("menuitemradio", { name: "In progress" }).click();
  await expect(schedule.locator(".agenda-row", { hasText: "Started task" }).getByRole("button", { name: /Status: In progress/ })).toBeVisible();

  // "Put off" and "Drop" are two different endings, and say so.
  await menu("Later task");
  await page.getByRole("menuitem", { name: "Put off for later…" }).click();
  const close = page.getByRole("dialog", { name: "Close this block" });
  await expect(close.getByRole("radio", { name: /another time/ })).toBeChecked();
  await close.getByRole("button", { name: "Save for later" }).click();
  await expect(close).toHaveCount(0);

  await menu("Dropped task");
  await page.getByRole("menuitem", { name: "Drop it…" }).click();
  await close.getByRole("button", { name: "Drop it" }).click();
  await expect(close).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Backlog" }).click();
  await expect(page.locator('.board-col[data-status="InProgress"]')).toContainText("Started task");
  await expect(page.locator('.board-col[data-status="Planned"]')).toContainText("Later task");
  await expect(page.locator('.board-col[data-status="Skipped"]')).toContainText("Dropped task");
});
