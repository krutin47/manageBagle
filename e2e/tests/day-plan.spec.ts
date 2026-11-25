import { expect, test } from "@playwright/test";
import { dayFromToday, signUp } from "./helpers";

test("a new person can plan a day from a brain dump, work it, and find it again after reloading", async ({ page }) => {
  await signUp(page);
  // Plan tomorrow: a whole empty day, so the result does not depend on what time the test runs.
  const tomorrow = await dayFromToday(page, 1);
  await page.goto(`/?date=${tomorrow}`);

  await page.getByRole("button", { name: "Start a brain dump" }).click();
  const box = page.getByLabel("What needs doing?");
  for (const task of ["Ship the importer", "Reply to recruiter emails", "Pick up suit from tailor", "Pay electricity bill"]) {
    await box.fill(task);
    await box.press("Enter");
  }
  const options = (task: string) => page.getByRole("group", { name: `Options for ${task}` });
  await options("Ship the importer").getByRole("button", { name: "Outcome impact: Medium impact" }).click();
  await page.getByRole("menuitemradio", { name: "High impact" }).click();
  // Choosing deep focus suggests two hours (P2-A2)…
  await options("Ship the importer").getByRole("button", { name: "Kind of work: Shallow work" }).click();
  await page.getByRole("menuitemradio", { name: "Deep focus" }).click();
  await expect(options("Ship the importer").getByRole("button", { name: "Length: 2h" })).toBeVisible();
  // …but a length chosen by hand wins.
  await options("Ship the importer").getByRole("button", { name: "Length: 2h" }).click();
  await page.getByRole("menuitemradio", { name: "1h 30m" }).click();
  await expect(options("Ship the importer").getByRole("button", { name: "Length: 1h 30m" })).toBeVisible();

  // Outside work is an icon with a tooltip that explains it (P2-A7).
  const outside = options("Pick up suit from tailor").getByRole("button", { name: "Outside work" });
  await outside.focus();
  await expect(page.getByRole("tooltip")).toContainText("errands, travel, appointments");
  await outside.click();
  await expect(outside).toHaveAttribute("aria-pressed", "true");

  // A due date sets urgency; there is no priority control any more (P2-A1).
  await options("Pay electricity bill").getByRole("button", { name: /Due date/ }).click();
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await expect(options("Pay electricity bill").getByRole("button", { name: "Due date: Due tomorrow" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Priority", { exact: true })).toHaveCount(0);

  // Sorting is a mode that stays on and visibly reorders (P2-A4).
  await page.getByRole("radiogroup", { name: "Sort the list by" }).getByRole("radio", { name: "Due date" }).check();
  await expect(page.locator(".dump-row .plan-title").first()).toHaveValue("Pay electricity bill");
  await page.getByRole("radiogroup", { name: "Sort the list by" }).getByRole("radio", { name: "Impact" }).check();
  await expect(page.locator(".dump-row .plan-title").first()).toHaveValue("Ship the importer");

  await page.getByRole("button", { name: /Next: top three/ }).click();
  await page.getByRole("button", { name: "Suggest for me" }).click();
  await expect(page.locator(".pick-row.is-top").first()).toContainText("Ship the importer"); // impact outranks the rest

  await page.getByRole("button", { name: /Next: fit into the day/ }).click();
  await expect(page.getByText("buffer for outside work")).toBeVisible();
  await page.getByRole("button", { name: "Yes, add them all" }).click();

  // The plan is on the page…
  const schedule = page.getByRole("region", { name: "Schedule" });
  await expect(schedule.getByRole("button", { name: /Ship the importer/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Day totals" })).toContainText("/ 4");

  // …ticking the top outcome finishes its block too (one piece of work, one tick)…
  await page.getByRole("checkbox", { name: "Outcome 1 done" }).click();
  await expect(schedule.getByRole("button", { name: /Status: Done/ })).toHaveCount(1);

  // …and all of it is still there after a reload: it was saved, not just shown.
  await page.reload();
  await expect(schedule.getByRole("button", { name: /Status: Done/ })).toHaveCount(1);
  await expect(schedule.getByRole("button", { name: /Pick up suit from tailor/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Outcome 1 done" })).toBeChecked();
});

test("a double click on the final button saves the plan once", async ({ page }) => {
  await signUp(page);
  const tomorrow = await dayFromToday(page, 1);
  await page.goto(`/?date=${tomorrow}`);
  await page.getByRole("button", { name: "Start a brain dump" }).click();
  await page.getByLabel("What needs doing?").fill("Write the report");
  await page.getByLabel("What needs doing?").press("Enter");
  await page.getByRole("button", { name: /Next: top three/ }).click();
  await page.getByRole("button", { name: /Next: fit into the day/ }).click();
  await page.getByRole("button", { name: "Add to the day" }).dblclick();

  await expect(page.getByRole("region", { name: "Schedule" }).getByRole("button", { name: /Write the report/ })).toHaveCount(1);
  await page.goto("/backlog?view=list");
  await expect(page.getByRole("button", { name: "Write the report", exact: true })).toHaveCount(1);
});

test("the day plan works on a phone with the keyboard and without sideways scrolling @phone", async ({ page }) => {
  await signUp(page);
  const tomorrow = await dayFromToday(page, 1);
  await page.goto(`/?date=${tomorrow}`);
  await page.getByRole("button", { name: "Start a brain dump" }).click();
  await page.getByLabel("What needs doing?").fill("Call the bank");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Next: top three/ }).click();
  await page.getByRole("button", { name: /Next: fit into the day/ }).click();
  await page.getByRole("button", { name: "Add to the day" }).click();
  await expect(page.getByRole("region", { name: "Schedule" }).getByRole("button", { name: /Call the bank/ })).toBeVisible();

  // Moving a block needs no drag: open it and change the time in the form.
  await page.getByRole("region", { name: "Schedule" }).getByRole("button", { name: /Call the bank/ }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Start", { exact: true }).fill("15:00");
  await form.getByLabel("End", { exact: true }).fill("15:30");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("region", { name: "Schedule" })).toContainText("15:00");

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
