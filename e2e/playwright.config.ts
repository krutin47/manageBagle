import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MAIL_DIR = path.join(here, ".mail");

const database = process.env.MB_E2E_POSTGRES ?? "Host=localhost;Port=5432;Database=managebagle_e2e;Username=managebagle;Password=managebagle";

/**
 * Runs the real API (against PostgreSQL) and the real client, and drives them in a browser.
 * Emails are written to e2e/.mail so tests can open the links a person would receive.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    // A fixed zone, so "today" in the browser and in the assertions agree on any machine.
    timezoneId: "America/Halifax",
    locale: "en-CA",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
  webServer: [
    {
      command: "dotnet run --project ../server/src/ManageBagle.Api --no-launch-profile",
      url: "http://localhost:5242/health/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ASPNETCORE_ENVIRONMENT: "Development",
        ASPNETCORE_URLS: "http://localhost:5242",
        ConnectionStrings__Default: database,
        Smtp__PickupDirectory: MAIL_DIR,
        RateLimits__AuthPerMinute: "10000",
        // The real wait is 72 hours; the browser test exercises the flow, the API tests the wait.
        Auth__MfaResetDelayHours: "0",
      },
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      cwd: "../client",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
