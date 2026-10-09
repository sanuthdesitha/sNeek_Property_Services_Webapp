import { defineConfig } from "@playwright/test";
import base from "../playwright.config";

// These workflows require an explicitly started server on the disposable DB.
// Never fall back to the ordinary dev command (which targets port 3000).
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: ["settings-navigation.spec.ts", "holiday-rates.spec.ts"],
  webServer: undefined,
  workers: 1,
  timeout: 120_000,
});
