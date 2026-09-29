import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"failed-upload.spec.ts",outputDir:"../../test-results/failed-upload",workers:1,use:{browserName:"chromium"}});
