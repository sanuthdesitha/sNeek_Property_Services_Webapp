import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "shopping-actual.spec.ts", workers: 1, outputDir: "../../test-results/shopping-actual", use: { baseURL: "http://localhost:3997" }, projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["Pixel 5"] } }] });
