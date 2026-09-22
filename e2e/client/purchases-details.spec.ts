import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/client/fixtures/purchases-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "next-auth/react": path.resolve("e2e/admin/fixtures/property-memory-session.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
for (const width of [390, 1440]) test(`client scoped purchases and approved labour details at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 800 });
  const purchase = { id: "run", title: "Purchases for your properties", date: "2026-09-22T01:00:00.000Z", shopper: "Alex", paymentMethod: null, total: 12, totalComplete: true, sharedRun: true, shoppingTime: null, receipts: [], lines: [{ itemName: "Household cleaning and bathroom supplies with a long catalogue name", property: "Harbour Apartment", qty: 2, unit: "bottles", lineCost: 12 }], billing: [{ id: "approved", property: "Harbour Apartment", status: "APPROVED", expenseAmount: 12, shoppingMinutes: 15, hourlyRate: 40, labourAmount: 10, treatment: "RECHARGE", invoice: { id: "invoice", number: "INV-001", status: "SENT" } }, { id: "pending", property: "Harbour Apartment", status: "PENDING_REVIEW" }] };
  await page.route("http://localhost:3994/**", route => route.request().url().includes("/api/") ? route.fulfill({ json: { runs: [purchase], hasMore: false } }) : route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>` }));
  await page.goto("http://localhost:3994/");
  await expect(page.getByText(/Shopping service: 15 minutes at \$40.00\/hour/)).toBeVisible(); await expect(page.getByText("Invoice INV-001: sent")).toBeVisible(); await expect(page.getByText(/Shared receipts and whole-run shopping time are withheld/)).toBeVisible(); await expect(page.getByText("No client charge has been approved yet.")).toBeVisible();
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1); await page.screenshot({ path: info.outputPath(`client-purchases-${width}.png`), fullPage: true });
});
