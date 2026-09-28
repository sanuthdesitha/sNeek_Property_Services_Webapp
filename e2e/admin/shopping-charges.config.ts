import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"shopping-charges.spec.ts",outputDir:"../../test-results/shopping-charges",workers:1,use:{browserName:"chromium"}});
