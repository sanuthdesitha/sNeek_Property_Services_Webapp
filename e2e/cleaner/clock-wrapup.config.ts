import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "clock-wrapup.spec.ts", workers: 1, outputDir: "../../test-results/clock-wrapup", use: { browserName: "chromium" } });
