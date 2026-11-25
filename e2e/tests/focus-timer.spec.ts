import { expect, test } from "@playwright/test";
import { advanceTime, signUp } from "./helpers";

// These tests move the server's clock, which every test in this file shares: run them one at a time.
test.describe.configure({ mode: "serial" });

async function planOneBlock(page: import("@playwright/test").Page, title: string, minutes = "30m") {
  await page.getByRole("button", { name: "Plan my day" }).click();
  await page.getByLabel("Add a new task to this plan").fill(title);
  await page.getByLabel("Add a new task to this plan").press("Enter");
  if (minutes !== "30m") {
    await page.getByRole("group", { name: `Options for ${title}` }).getByRole("button", { name: /^Length/ }).click();
    await page.getByRole("menuitemradio", { name: minutes }).click();
  }
  await page.getByRole("button", { name: /Next: top three/ }).click();
  await page.getByRole("button", { name: /Next: fit into the day/ }).click();
  await page.getByRole("button", { name: "Add to the day" }).click();
}

test("press play, pause, and the time worked is recorded and survives a reload", async ({ page }) => {
  await signUp(page);
  await page.goto("/");
  await planOneBlock(page, "Write the report");
  const schedule = page.getByRole("region", { name: "Schedule" });

  await schedule.getByRole("button", { name: "Start timer for Write the report" }).click();
  const bar = page.getByRole("region", { name: "Focus timer" });
  await expect(bar).toContainText("Write the report");

  await advanceTime(page, 12);
  await expect(bar).toContainText("12:0");
  await bar.getByRole("button", { name: "Pause Write the report" }).click();
  await expect(bar).toHaveCount(0);

  await page.reload();
  const row = page.getByRole("region", { name: "Schedule" });
  await expect(row.getByRole("button", { name: "Resume timer for Write the report" })).toBeVisible();
  await expect(row.getByLabel("Actual minutes for Write the report")).toHaveValue("12");
});

test("only one block runs at a time; starting another asks first", async ({ page }) => {
  await signUp(page);
  await page.goto("/");
  await planOneBlock(page, "First thing");
  await planOneBlock(page, "Second thing");

  const schedule = page.getByRole("region", { name: "Schedule" });
  await schedule.getByRole("button", { name: "Start timer for First thing" }).click();
  await expect(page.getByRole("region", { name: "Focus timer" })).toContainText("First thing");
  await schedule.getByRole("button", { name: "Start timer for Second thing" }).click();
  const ask = page.getByRole("dialog", { name: "Switch what you are working on?" });
  await expect(ask).toContainText("“First thing” is running");
  await ask.getByRole("button", { name: /Pause it and start/ }).click();
  await expect(page.getByRole("region", { name: "Focus timer" })).toContainText("Second thing");
  // Paused within a second or two, so it has no time banked and offers "Start" again.
  await expect(schedule.getByRole("button", { name: /(Start|Resume) timer for First thing/ })).toBeVisible();
});

test("time's up asks whether more time is needed, and stopping can drop the task with a note", async ({ page }) => {
  await signUp(page);
  await page.goto("/");
  await planOneBlock(page, "Tidy the garage", "15m");
  await page.getByRole("region", { name: "Schedule" }).getByRole("button", { name: "Start timer for Tidy the garage" }).click();

  await advanceTime(page, 15.1);
  const timeUp = page.getByRole("dialog", { name: "Time's up" });
  await expect(timeUp).toContainText("Need more time?");
  await timeUp.getByRole("button", { name: "+15 min" }).click();
  await expect(page.getByRole("region", { name: "Focus timer" })).toContainText("/ 30m");

  await page.getByRole("region", { name: "Focus timer" }).getByRole("button", { name: "Stop Tidy the garage" }).click();
  const stop = page.getByRole("dialog", { name: "Stop the timer" });
  await stop.getByRole("radio", { name: /Drop it/ }).check();
  await stop.getByLabel("Why are you dropping it?").fill("Selling the house instead");
  await stop.getByRole("button", { name: "Drop it" }).click();
  await expect(page.getByRole("region", { name: "Focus timer" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Schedule" }).getByRole("button", { name: /Status: Skipped/ })).toBeVisible();

  await page.goto("/review");
  await expect(page.getByText("Selling the house instead")).toBeVisible();
});
