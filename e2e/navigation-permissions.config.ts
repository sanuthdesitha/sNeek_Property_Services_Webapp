import { defineConfig } from "@playwright/test";
import base from "../playwright.config";
export default defineConfig({
  ...base,
  projects: base.projects?.filter(
    (project) => project.name === "chromium-desktop",
  ),
  testDir: ".",
  testMatch: "navigation-permissions.spec.ts",
  webServer: undefined,
  workers: 1,
  timeout: 180_000,
});
