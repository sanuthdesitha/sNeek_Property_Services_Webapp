import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "held-stock.spec.ts", outputDir: "../../test-results/admin-held-stock", workers: 1, use: { browserName: "chromium", screenshot: "only-on-failure" } });
