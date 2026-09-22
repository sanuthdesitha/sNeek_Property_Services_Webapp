import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "own-stock.spec.ts", outputDir: "../../test-results/own-stock", workers: 1, use: { browserName: "chromium", screenshot: "only-on-failure" } });
