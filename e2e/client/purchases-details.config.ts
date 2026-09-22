import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "purchases-details.spec.ts", outputDir: "../../test-results/client-purchases-details", workers: 1, use: { browserName: "chromium", screenshot: "only-on-failure" } });
