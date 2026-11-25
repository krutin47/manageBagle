import { expect, test } from "@playwright/test";
import { dayFromToday, signUp } from "./helpers";

test("the plan can be subscribed to from another calendar app, and unsafe calendar addresses are explained", async ({
  page,
  browser,
}) => {
  await signUp(page);
  const day = await dayFromToday(page, 1);
  await page.goto(`/planner?date=${day}`);
  await page.getByRole("button", { name: "New block" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Specific task or outcome").fill("Write the proposal");
  await form.getByLabel("Start", { exact: true }).fill("14:00");
  await form.getByLabel("End", { exact: true }).fill("15:00");
  await form.getByRole("button", { name: "Add block" }).click();
  await expect(page.getByRole("button", { name: /^Write the proposal/ })).toBeVisible(); // saved before moving on

  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Calendars" });
  await card.getByRole("button", { name: "Get my subscription link" }).click();
  const link = card.getByLabel("Your private calendar subscription link");
  await expect(link).toHaveValue(/\/api\/calendar\/feed\/[\w-]+\.ics$/);
  const url = new URL(await link.inputValue());

  // A calendar app has no cookie: the link alone is enough, and it only carries titles and times.
  const calendarApp = await browser.newContext();
  const feed = await calendarApp.request.get(`http://localhost:5173${url.pathname}`);
  expect(feed.ok()).toBeTruthy();
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  expect(await feed.text()).toContain("SUMMARY:Write the proposal");

  // Making a new link kills the old one.
  await card.getByRole("button", { name: "Make a new link" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Make a new link" }).click();
  await expect(link).not.toHaveValue(url.toString());
  expect((await calendarApp.request.get(`http://localhost:5173${url.pathname}`)).status()).toBe(404);
  await calendarApp.close();

  // Connecting a calendar: an unencrypted or private address is refused with a reason, and nothing is saved.
  await card.getByRole("button", { name: "Connect a calendar" }).click();
  const connect = page.getByRole("dialog", { name: "Connect a calendar" });
  await connect.getByLabel("Private iCal address").fill("http://calendar.example.com/basic.ics");
  await connect.getByRole("button", { name: "Connect" }).click();
  await expect(connect.getByRole("alert")).toContainText("https://");
  await connect.getByLabel("Private iCal address").fill("https://169.254.169.254/latest/meta-data");
  await connect.getByRole("button", { name: "Connect" }).click();
  await expect(connect.getByRole("alert")).toContainText("private network");
});
