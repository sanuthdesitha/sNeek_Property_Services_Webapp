import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "job-clean-ui.spec.ts", workers: 1, outputDir: "../../test-results/job-clean-ui", use: { browserName: "chromium" } });
