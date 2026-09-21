import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "laundry-redesign.spec.ts", workers: 1, use: { browserName: "chromium", screenshot: "only-on-failure" } });
