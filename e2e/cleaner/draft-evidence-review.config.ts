import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "draft-evidence-review.spec.ts", outputDir: "../../test-results/draft-evidence-review", workers: 1, use: { browserName: "chromium", screenshot: "only-on-failure" } });
