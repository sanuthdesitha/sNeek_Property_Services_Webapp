import { defineConfig } from "@playwright/test";
// Synthetic components and API responses: no application server, DB or providers.
export default defineConfig({ testDir: ".", testMatch: "responsive.spec.ts", outputDir: "../../test-results/laundry-responsive", workers: 1, use: { browserName: "chromium", screenshot: "only-on-failure" } });
