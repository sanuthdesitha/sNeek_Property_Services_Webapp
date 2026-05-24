import { defineConfig, devices } from "@playwright/test";

// Separate config for audit runs to allow running on a non-default port
// (e.g. when port 3000 is held by another local process).
const PORT = process.env.AUDIT_PORT || "3100";
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: `node ./scripts/run-next.cjs dev -H 0.0.0.0 -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
