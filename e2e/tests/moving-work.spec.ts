import { expect, test } from "@playwright/test";
import { dayFromToday, signUp } from "./helpers";

test("a calendar block dragged to another time stays there after a reload", async ({ page }) => {
  await signUp(page);
  const day = await dayFromToday(page, 1);
  await page.goto(`/planner?date=${day}`);
  await page.getByRole("button", { name: "New block" }).click();
  await page.getByLabel("Specific task or outcome").fill("Deep work session");
  const form = page.getByRole("dialog");
  await form.getByLabel("Start", { exact: true }).fill("09:00");
  await form.getByLabel("End", { exact: true }).fill("10:00");
  await form.getByRole("button", { name: "Add block" }).click();

  const block = page.getByRole("button", { name: /^Deep work session/ });
  await expect(block).toHaveAccessibleName(/9:00.*10:00/);
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 40, { steps: 5 });
  await page.mouse.move(box.x + 20, box.y + 10 + 112, { steps: 10 }); // two hours down
  await page.mouse.up();

  await expect(page.getByRole("dialog")).toHaveCount(0); // a drag is not a click
  await expect(block).toHaveAccessibleName(/11:00.*12:00/);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Deep work session/ })).toHaveAccessibleName(/11:00.*12:00/);
});

test("a backlog card can be moved between columns with the keyboard alone", async ({ page }) => {
  await signUp(page);
  await page.goto("/backlog");
  await page.getByLabel("Capture a task").fill("Renew passport");
  await page.keyboard.press("Enter");

  const card = page.locator(".board-card-wrap", { hasText: "Renew passport" });
  await card.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status").filter({ hasText: /Picked up Renew passport\.|Over To do\./ })).toBeAttached();
  await page.keyboard.press("ArrowRight"); // one press, one column
  await expect(page.getByRole("status").filter({ hasText: "Over In progress." })).toBeAttached();
  await page.keyboard.press("Space");

  const inProgress = page.getByRole("region", { name: /^In progress/ });
  await expect(inProgress.getByText("Renew passport")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: /^In progress/ }).getByText("Renew passport")).toBeVisible();
});

test("a stale tab is told about the conflict instead of overwriting newer work", async ({ page, context }) => {
  await signUp(page);
  const day = await dayFromToday(page, 1);
  await page.goto(`/planner?date=${day}&view=list`);
  await page.getByRole("button", { name: "New block" }).click();
  await page.getByLabel("Specific task or outcome").fill("Shared block");
  await page.getByRole("button", { name: "Add block" }).click();
  await expect(page.getByRole("button", { name: "Shared block" })).toBeVisible();

  // The same account in a second tab opens the block for editing…
  const other = await context.newPage();
  await other.goto(`/planner?date=${day}&view=list`);
  await other.getByRole("button", { name: "Shared block" }).click();
  await other.getByLabel("Specific task or outcome").fill("Edited in the stale tab");

  // …meanwhile the first tab saves a change.
  await page.getByRole("button", { name: "Shared block" }).click();
  await page.getByLabel("Specific task or outcome").fill("Edited first");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Edited first" })).toBeVisible();

  // The stale tab's save is refused, with an explanation, and nothing is overwritten.
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(other.getByRole("alert").filter({ hasText: /changed somewhere else/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Edited first" })).toBeVisible();
});
