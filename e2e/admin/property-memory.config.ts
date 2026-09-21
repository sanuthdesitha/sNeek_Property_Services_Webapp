import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "property-memory.spec.ts", outputDir: "../../test-results/property-memory", workers: 1, use: { browserName: "chromium", screenshot: "only-on-failure" } });
