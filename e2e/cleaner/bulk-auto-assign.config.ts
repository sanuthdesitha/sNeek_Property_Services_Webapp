import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "bulk-auto-assign.spec.ts", outputDir: "../../test-results/bulk-auto-assign", workers: 1, use: { browserName: "chromium", screenshot: "only-on-failure" } });
