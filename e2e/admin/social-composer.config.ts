import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "social-composer.spec.ts", workers: 1, outputDir: "../../test-results/social-composer", use: { baseURL: "http://localhost:3998" }, projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["Pixel 5"] } }] });
