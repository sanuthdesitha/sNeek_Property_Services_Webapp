import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "sending-safeguards.spec.ts", outputDir: "../../test-results/sending-safeguards", workers: 1, use: { browserName: "chromium", ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) } });
