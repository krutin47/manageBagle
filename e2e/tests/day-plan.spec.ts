import { expect, test } from "@playwright/test";
import { dayFromToday, signUp } from "./helpers";

test("the brain dump only captures; Plan my day chooses from the backlog, and the three roll on as work is finished", async ({
  page,
}) => {
  await signUp(page);
  // Plan tomorrow: a whole empty day, so the result does not depend on what time the test runs.
  const tomorrow = await dayFromToday(page, 1);

  // Capture is one click from any page (P2-E1) — here, the Planner.
  await page.goto("/planner");
  await page.getByRole("button", { name: "Brain dump", exact: true }).click();
  const box = page.getByLabel("What is on your mind?");
  for (const task of [
    "Ship the importer",
    "Reply to recruiter emails",
    "Pick up suit from tailor",
    "Pay electricity bill",
  ]) {
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
  await options("Pay electricity bill")
    .getByRole("button", { name: /Due date/ })
    .click();
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await expect(options("Pay electricity bill").getByRole("button", { name: "Due date: Due tomorrow" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Priority", { exact: true })).toHaveCount(0);

  // Sorting is a mode that stays on and visibly reorders (P2-A4).
  await page.getByRole("radiogroup", { name: "Sort the list by" }).getByRole("radio", { name: "Due date" }).check();
  await expect(page.locator(".dump-row .plan-title").first()).toHaveValue("Pay electricity bill");
  await page.getByRole("radiogroup", { name: "Sort the list by" }).getByRole("radio", { name: "Impact" }).check();
  await expect(page.locator(".dump-row .plan-title").first()).toHaveValue("Ship the importer");

  // Saving puts everything in the backlog and books nothing: the brain dump does not plan.
  await page.getByRole("button", { name: "Save to backlog" }).click();
  await expect(page.getByText("4 tasks added to your backlog")).toBeVisible();
  await page.goto(`/?date=${tomorrow}`);
  await expect(page.getByRole("heading", { name: "Nothing planned for this day yet" })).toBeVisible();

  // Plan my day starts from the backlog (P2-E2): what is due soon is offered first.
  await page.getByRole("button", { name: "Plan my day" }).click();
  const plan = page.getByRole("dialog");
  await expect(plan.getByRole("region", { name: "Overdue and due this week" })).toContainText("Pay electricity bill");
  for (const task of [
    "Ship the importer",
    "Reply to recruiter emails",
    "Pick up suit from tailor",
    "Pay electricity bill",
  ]) {
    await plan.getByRole("button", { name: new RegExp(`^${task}`) }).click();
  }
  await expect(plan.getByRole("button", { name: /^Ship the importer/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Next: top three \(4 chosen\)/ }).click();
  await page.getByRole("button", { name: "Suggest for me" }).click();
  await expect(page.locator(".pick-row.is-top").first()).toContainText("Ship the importer"); // impact outranks the rest

  await page.getByRole("button", { name: /Next: fit into the day/ }).click();
  await expect(page.getByText("buffer for outside work")).toBeVisible();
  await page.getByRole("button", { name: "Yes, add them all" }).click();

  // The plan is on the page…
  const schedule = page.getByRole("region", { name: "Schedule" });
  await expect(schedule.locator(".agenda-title", { hasText: "Ship the importer" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Day totals" })).toContainText("/ 4");

  // …finishing the first of the three finishes its block, and the next task in line moves up (P2-F2)…
  const three = page.getByRole("region", { name: "Top three" });
  await page.getByRole("checkbox", { name: "Outcome 1 done: Ship the importer" }).click();
  await expect(schedule.getByRole("button", { name: /Status: Done/ })).toHaveCount(1);
  await expect(three.locator(".outcome")).toHaveCount(3);
  await expect(three.getByText("Next in line", { exact: true })).toBeVisible();
  await expect(three.getByText("Done for the day")).toBeVisible();

  // …and all of it is still there after a reload: it was saved, not just shown.
  await page.reload();
  await expect(schedule.getByRole("button", { name: /Status: Done/ })).toHaveCount(1);
  await expect(schedule.locator(".agenda-title", { hasText: "Pick up suit from tailor" })).toBeVisible();
  await expect(three.getByText("Next in line", { exact: true })).toBeVisible();

  // The board shows the same state (P2-G1).
  await page.goto("/backlog");
  await expect(page.locator('.board-col[data-status="Done"]')).toContainText("Ship the importer");
});

test("a double click on the final button saves the plan once", async ({ page }) => {
  await signUp(page);
  const tomorrow = await dayFromToday(page, 1);
  await page.goto(`/?date=${tomorrow}`);
  await page.getByRole("button", { name: "Plan my day" }).click();
  await page.getByLabel("Add a new task to this plan").fill("Write the report");
  await page.getByLabel("Add a new task to this plan").press("Enter");
  await page.getByRole("button", { name: /Next: top three/ }).click();
  await page.getByRole("button", { name: /Next: fit into the day/ }).click();
  await page.getByRole("button", { name: "Add to the day" }).dblclick();

  await expect(
    page.getByRole("region", { name: "Schedule" }).locator(".agenda-title", { hasText: "Write the report" }),
  ).toHaveCount(1);
  await page.goto("/backlog?view=list");
  await expect(page.getByRole("button", { name: "Write the report", exact: true })).toHaveCount(1);
});

test("the day plan works on a phone with the keyboard and without sideways scrolling @phone", async ({ page }) => {
  await signUp(page);
  const tomorrow = await dayFromToday(page, 1);
  await page.goto(`/?date=${tomorrow}`);
  await page.getByRole("button", { name: "Plan my day" }).click();
  await page.getByLabel("Add a new task to this plan").fill("Call the bank");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Next: top three/ }).click();
  await page.getByRole("button", { name: /Next: fit into the day/ }).click();
  await page.getByRole("button", { name: "Add to the day" }).click();
  await expect(
    page.getByRole("region", { name: "Schedule" }).locator(".agenda-title", { hasText: "Call the bank" }),
  ).toBeVisible();

  // Moving a block needs no drag: open it and change the time in the form.
  await page.getByRole("region", { name: "Schedule" }).locator(".agenda-title", { hasText: "Call the bank" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Start", { exact: true }).fill("15:00");
  await form.getByLabel("End", { exact: true }).fill("15:30");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("region", { name: "Schedule" })).toContainText("15:00");

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("a brain dump left unsaved is still there when it is opened again, and a pasted list becomes one task per line", async ({
  page,
}) => {
  await signUp(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Brain dump", exact: true }).click();
  await page.getByLabel("What is on your mind?").focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "- Book dentist\n- Renew passport\n3. Call mum");
    document.activeElement!.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.locator(".dump-row .plan-title")).toHaveCount(3);
  await expect(page.locator(".dump-row .plan-title").last()).toHaveValue("Call mum");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "Brain dump", exact: true }).click();
  await expect(page.locator(".dump-row .plan-title")).toHaveCount(3);
});
