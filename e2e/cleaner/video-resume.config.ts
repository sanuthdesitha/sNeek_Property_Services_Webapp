import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "video-resume.spec.ts", outputDir: "../../test-results/video-resume", workers: 1, timeout: 60_000, use: { browserName: "chromium" } });
