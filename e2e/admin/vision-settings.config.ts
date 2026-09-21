import { defineConfig, devices } from "@playwright/test";
// Synthetic real-component flow: all navigation and transport are intercepted.
export default defineConfig({
  testDir: ".", testMatch: ["vision-settings.spec.ts", "photo-review.spec.ts"], workers: 1,
  outputDir: "../../test-results/vision-settings",
  use: { baseURL: "http://localhost:3998" },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 5"] } },
  ],
});
