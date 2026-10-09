import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "jobs-loading.spec.ts",
  workers: 1,
  timeout: 90_000,
  outputDir: "../test-results/jobs-loading",
  use: {
    baseURL: "http://127.0.0.1:3023",
    browserName: "chromium",
    serviceWorkers: "block",
  },
  webServer: {
    cwd: path.resolve(__dirname, ".."),
    command:
      "NEXT_DIST_DIR=.next-prod DATABASE_URL=postgresql://sneek@127.0.0.1:55439/sneek_review_test SNEEK_WEB_SCHEDULER_ENABLED=false NEXTAUTH_URL=http://127.0.0.1:3023 NEXTAUTH_SECRET=jobs-browser-test NEXTAUTH_URL_INTERNAL=http://127.0.0.1:9 node -r ./scripts/fs-readlink-patch.cjs scripts/run-next.cjs start --hostname 127.0.0.1 --port 3023",
    url: "http://127.0.0.1:3023/manifest.json",
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
