import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// ADR-019. A real push needs the browser vendor's push service, which a test cannot reach; the
// server side (encryption, signing, scheduling, de-duplication) is covered by PushTests.
test.use({ permissions: ["notifications"] });

test("the app can be installed and its service worker registers; notifications can be turned on from Routines", async ({
  page,
}) => {
  await signUp(page);
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  expect((await page.request.get("/icons/icon-192.png")).headers()["content-type"]).toContain("image/png");

  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.register("/sw.js", { scope: "/" })).scope,
  );
  expect(scope).toMatch(/\/$/);

  await page.goto("/routines");
  const control = page.getByRole("group", { name: "Notifications on this device" });
  await expect(control.getByRole("button", { name: "Turn on notifications" })).toBeVisible();
});
