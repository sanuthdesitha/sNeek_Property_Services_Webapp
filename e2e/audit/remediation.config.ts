import { defineConfig } from "@playwright/test";
// Actual components, synthetic API: no Next server, database or providers.
export default defineConfig({
  testDir: ".", testMatch: "remediation.spec.ts", workers: 1,
  outputDir: "/tmp/sneek-e2e-results", reporter: "list",
  use: { browserName: "chromium", launchOptions: { executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-background-networking"] } },
});
