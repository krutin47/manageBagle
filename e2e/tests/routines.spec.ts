import { expect, test } from "@playwright/test";
import { dayFromToday, signUp } from "./helpers";

test("routines and recovery breaks shape the plan, and show on Today", async ({ page }) => {
  await signUp(page);
  // Pre-planning has its own page (P2-E3).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Routines" }).click();
  await expect(page).toHaveURL(/\/routines$/);

  // A protected lunch, and work hours that only take Build work.
  const addRoutine = async (name: string, start: string, end: string, policy: string, area?: string) => {
    await page.getByRole("button", { name: "Add routine" }).click();
    const form = page.getByRole("dialog", { name: "New routine" });
    await form.getByLabel("Name").fill(name);
    for (const d of ["Sat", "Sun"]) await form.getByRole("button", { name: d, exact: true }).click(); // weekdays → every day
    await form.getByLabel("Starts", { exact: true }).fill(start);
    await form.getByLabel("Ends", { exact: true }).fill(end);
    await form.getByRole("radio", { name: policy }).check();
    if (area) await form.getByRole("button", { name: area }).click();
    await form.getByRole("button", { name: "Add routine" }).click();
    await expect(form).toHaveCount(0);
  };
  // Lunch from a ready-made starting point: one click fills the form in, to adjust and save.
  await page.getByRole("group", { name: "Start from a template" }).getByRole("button", { name: /Lunch/ }).click();
  const lunch = page.getByRole("dialog", { name: "New routine" });
  await expect(lunch.getByLabel("Name")).toHaveValue("Lunch");
  for (const d of ["Sat", "Sun"]) await lunch.getByRole("button", { name: d, exact: true }).click(); // weekdays → every day
  await lunch.getByRole("button", { name: "Add routine" }).click();
  await expect(lunch).toHaveCount(0);
  await addRoutine("Work hours", "09:00", "12:30", "Only some areas", "Build / Deep work");
  const schedule = page.getByRole("region", { name: "Fixed schedule" });
  await expect(schedule).toContainText("Every day · 12:30–13:15 · no tasks · meal reminder");
  await expect(page.getByRole("group", { name: "Start from a template" }).getByRole("button", { name: /Lunch/ })).toHaveCount(0);

  // Every Build task gets a 15-minute recovery break after it.
  await page.getByLabel("Break length for Build / Deep work").selectOption({ label: "15 min break" });
  await expect(page.getByLabel("When the break for Build / Deep work happens")).toBeEnabled();

  const tomorrow = await dayFromToday(page, 1);
  await page.goto(`/?date=${tomorrow}`);
  await page.getByRole("button", { name: "Plan my day" }).click();
  const box = page.getByLabel("Add a new task to this plan");
  for (const t of ["Ship the importer", "Do the laundry"]) { await box.fill(t); await box.press("Enter"); }
  const ship = page.getByRole("group", { name: "Options for Ship the importer" });
  await ship.getByRole("button", { name: /^Focus area/ }).click();
  await page.getByRole("menuitemradio", { name: "Build / Deep work" }).click();
  await ship.getByRole("button", { name: /^Length/ }).click();
  await page.getByRole("menuitemradio", { name: "3h" }).click();
  await page.getByRole("group", { name: "Options for Do the laundry" }).getByRole("button", { name: /^Focus area/ }).click();
  await page.getByRole("menuitemradio", { name: "Home / Admin" }).click();

  await page.getByRole("button", { name: /Next: top three/ }).click();
  await page.getByRole("button", { name: /Next: fit into the day/ }).click();
  await page.getByLabel("Start from").fill("08:00");

  const fit = page.locator(".plan-fit");
  const row = (title: string) => fit.locator(".fit-row", { hasText: title });
  // Build work goes inside work hours, with its recovery break; it does not spill into lunch.
  await expect(row("Ship the importer")).toContainText("09:00");
  await expect(row("Ship the importer")).toContainText("in Work hours");
  await expect(row("Ship the importer")).toContainText("15m recovery after");
  // Home work stays out of both: before work hours, not in lunch.
  await expect(row("Do the laundry")).toContainText("08:00");
  await expect(row("Lunch")).toContainText("protected");

  await page.getByRole("button", { name: "Yes, add them all" }).click();
  const today = page.getByRole("region", { name: "Schedule" });
  await expect(today.getByLabel(/Routine: Lunch, 12:30 to 13:15/)).toBeVisible();
  await expect(today).toContainText("15m recovery after");

  // The Planner shows the routine, the break and a key that explains them (P2-H1).
  await page.goto(`/planner?date=${tomorrow}`);
  await expect(page.locator(".cal-routine", { hasText: "Lunch · protected" }).first()).toBeVisible();
  await expect(page.locator(".cal-break").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Calendar key" })).toContainText("Recovery break");
  await page.goto(`/planner?date=${tomorrow}&view=list`);
  await expect(page.locator(".table")).toContainText("15m recovery after");
});
