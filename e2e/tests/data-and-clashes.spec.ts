import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { dayFromToday, signUp } from "./helpers";

test("a block placed over protected time is flagged, in the editor, on Today and in the Planner", async ({ page }) => {
  await signUp(page);
  await page.goto("/routines");
  await page.getByRole("group", { name: "Start from a template" }).getByRole("button", { name: /Lunch/ }).click();
  const routine = page.getByRole("dialog", { name: "New routine" });
  for (const d of ["Sat", "Sun"]) await routine.getByRole("button", { name: d, exact: true }).click(); // every day
  await routine.getByRole("button", { name: "Add routine" }).click();
  await expect(routine).toHaveCount(0);

  const day = await dayFromToday(page, 1);
  await page.goto(`/planner?date=${day}`);
  await page.getByRole("button", { name: "New block" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Specific task or outcome").fill("Call over lunch");
  await form.getByLabel("Start", { exact: true }).fill("12:00");
  await form.getByLabel("End", { exact: true }).fill("13:00");
  await expect(form.getByRole("status").filter({ hasText: "Overlaps Lunch" })).toBeVisible();
  await form.getByRole("button", { name: "Add block" }).click(); // allowed, but flagged
  await expect(page.locator(".cal-block.is-clash", { hasText: "Call over lunch" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Call over lunch.*Overlaps Lunch/ })).toBeVisible();

  await page.goto(`/?date=${day}`);
  await expect(page.getByRole("region", { name: "Schedule" }).locator(".clash-tag")).toContainText("Overlaps Lunch");
});

test("a person can download all of their data, and see older finished work on the board", async ({ page }) => {
  await signUp(page);
  await page.goto("/backlog");
  await page.getByLabel("Capture a task").fill("Export me");
  await page.keyboard.press("Enter");
  await expect(page.locator(".board-card-wrap", { hasText: "Export me" })).toBeVisible();
  await expect(page.getByText("Finished and dropped tasks stay here for 30 days.")).toBeVisible();
  await page.getByRole("button", { name: "Show all history" }).click();
  await expect(page.getByRole("button", { name: "Show the last 30 days only" })).toBeVisible();
  await expect(page.locator(".board-card-wrap", { hasText: "Export me" })).toBeVisible();

  await page.goto("/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download my data" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^managebagle-export-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(data.tasks.map((t: { title: string }) => t.title)).toContain("Export me");
  expect(JSON.stringify(data)).not.toMatch(/passwordHash|securityStamp/i);
});
