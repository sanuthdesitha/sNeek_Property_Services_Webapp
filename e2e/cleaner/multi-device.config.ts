import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "multi-device.spec.ts", workers: 1, timeout: 90_000, outputDir: "../../test-results/multi-device", use: { browserName: "chromium" } });
