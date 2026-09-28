import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"ollama-settings.spec.ts",outputDir:"../../test-results/ollama-settings",workers:1,use:{browserName:"chromium"}});
