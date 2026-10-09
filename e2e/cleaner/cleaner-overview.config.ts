import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "cleaner-overview.spec.ts", workers: 1, outputDir: "../../test-results/cleaner-overview", use: { browserName: "chromium" } });
