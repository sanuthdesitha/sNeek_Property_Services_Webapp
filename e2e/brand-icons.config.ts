import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "brand-icons.spec.ts",
  workers: 1,
  timeout: 90_000,
  outputDir: "../test-results/brand-icons",
  use: { baseURL: "http://127.0.0.1:3022", browserName: "chromium" },
  webServer: {
    cwd: path.resolve(__dirname, ".."),
    command:
      "NEXT_DIST_DIR=.next-prod DATABASE_URL=postgresql://sneek@127.0.0.1:55439/sneek_review_test SNEEK_WEB_SCHEDULER_ENABLED=false NEXTAUTH_SECRET=brand-icon-browser-test node -r ./scripts/fs-readlink-patch.cjs node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3022",
    url: "http://127.0.0.1:3022/manifest.json",
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
