import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/own-stock-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "next-auth/react": path.resolve("e2e/admin/fixtures/property-memory-session.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});

test("repeat additions share one item total and retain separate edit controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const item = { id: "soap", name: "Soap", unit: "bottles", category: "Cleaning" };
  const holdings = [2, 3].map((quantity, index) => ({ id: `held-${index}`, quantity, updatedAt: "2026-09-22T01:00:00.000Z", item }));
  await page.route("http://localhost:3996/**", async route => {
    if (route.request().url().includes("/api/")) return route.fulfill({ json: { holdings, items: [item] } });
    return route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>` });
  });
  await page.goto("http://localhost:3996/");
  await expect(page.getByRole("heading", { name: "Cleaning · Soap" })).toHaveCount(1);
  await expect(page.getByText("Total: 5 bottles(s) · 2 entries")).toBeVisible();
  await page.getByText("View entries and update stock", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Set remaining quantity" })).toHaveCount(2);
  await page.getByRole("button", { name: "Set remaining quantity" }).last().click();
  await expect(page.getByLabel("Remaining quantity")).toHaveValue("3");
});
for (const width of [320, 390, 1440]) test(`personal stock creation and zero correction at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 780 });
  const item = { id: "soap", name: "Refill laundry and cleaning soap", unit: "bottles" };
  let holdings: any[] = [], lost = false; const patches: any[] = [];
  await page.route("http://localhost:3996/**", async route => {
    if (route.request().url().includes("/api/")) {
      const method = route.request().method();
      if (method === "POST") { const body = route.request().postDataJSON(); holdings = [{ id: "held", quantity: body.quantity, updatedAt: "2026-09-22T01:00:00.000Z", item }]; return route.fulfill({ json: { ok: true, id: "held" } }); }
      if (method === "PATCH") { const body = route.request().postDataJSON(); patches.push(body); holdings = [{ ...holdings[0], quantity: body.quantity, updatedAt: "2026-09-22T02:00:00.000Z" }]; if (!lost) { lost = true; return route.abort(); } return route.fulfill({ json: { ok: true, id: "held", duplicated: true } }); }
      return route.fulfill({ json: { holdings, items: [item] } });
    }
    return route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>` });
  });
  await page.goto("http://localhost:3996/");
  await page.getByText("Recover an earlier single-item entry", { exact: true }).click();
  await page.getByLabel("Stock item", { exact: true }).selectOption("soap"); await page.getByLabel("Quantity to add").fill("3"); await page.getByRole("button", { name: "Record my stock" }).click();
  await expect(page.getByText("3 bottles(s) on hand")).toBeVisible();
  await page.getByRole("button", { name: "Set remaining quantity" }).click(); await page.getByLabel("Remaining quantity").fill("0"); await page.getByLabel("Reason for adjustment").fill("Used on today's cleaning"); await page.getByRole("button", { name: "Save remaining quantity" }).click();
  await expect(page.getByRole("button", { name: "Retry same stock entry" })).toBeVisible(); await page.reload();
  await expect(page.getByText("0 bottles(s) on hand")).toBeVisible(); await page.getByRole("button", { name: "Set remaining quantity" }).click();
  await page.getByRole("button", { name: "Retry same stock entry" }).click(); await expect.poll(() => patches.length).toBe(2); expect(patches[1]).toEqual(patches[0]);
  await expect(page.getByRole("button", { name: "Deliver", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`own-stock-${width}.png`), fullPage: true });
});
for (const width of [320, 390]) test(`atomic multi-item stock and recovered delivery at ${width}px`, async ({ page }, info) => {
 await page.setViewportSize({ width, height: 800 });
 const items = [{ id: "soap", name: "Soap", unit: "bottles" }, { id: "cloth", name: "Cloths", unit: "each" }];
 let holdings: any[] = []; const deliveries: any[] = []; let failed = false;
 await page.route("http://localhost:3996/**", async route => {
  if (route.request().url().endsWith("/batch")) {
   const body = route.request().postDataJSON();
   if (body.action === "RECORD") {
    if (!failed) { failed = true; return route.fulfill({ status: 409, json: { error: "Second item unavailable; no items saved" } }); }
    holdings = body.entries.map((entry: any, i: number) => ({ id: `held${i}`, quantity: entry.quantity, updatedAt: "2026-09-22T01:00:00.000Z", item: items.find(item => item.id === entry.itemId) }));
    return route.fulfill({ json: { ok: true, batchId: `held_batch_${"a".repeat(64)}`, results: holdings.map(({ id }) => ({ id })) } });
   }
   deliveries.push(body); holdings = [];
   if (deliveries.length === 1) return route.abort();
   return route.fulfill({ json: { ok: true, batchId: `held_batch_${"b".repeat(64)}`, results: [...body.entries].reverse().map((entry: any) => ({ id: entry.heldStockId, deliveryId: `delivery-${entry.heldStockId}` })) } });
  }
  if (route.request().url().includes("/api/")) return route.fulfill({ json: { holdings, items } });
  return route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>` });
 });
 await page.goto("http://localhost:3996/");
 await page.getByLabel("Stock item 1", { exact: true }).selectOption("soap"); await page.getByLabel("Quantity to record 1").fill("2");
 await page.getByText("Add another item", { exact: true }).click(); await page.getByLabel("Stock item 2").selectOption("cloth"); await page.getByLabel("Quantity to record 2").fill("3");
 await page.getByRole("button", { name: "Record 2 items" }).click(); await expect(page.getByText("Second item unavailable; no items saved")).toBeVisible(); expect(holdings).toHaveLength(0); await expect(page.getByLabel("Quantity to record 1")).toHaveValue("2"); await expect(page.getByLabel("Quantity to record 2")).toHaveValue("3");
 await page.getByRole("button", { name: "Record 2 items" }).click(); await expect(page.getByLabel("Select holding 2")).toBeVisible();
 await page.getByLabel("Bulk delivery property").selectOption("property"); await page.getByLabel("Select holding 1").check(); await page.getByLabel("Select holding 2").check();
 await page.getByRole("button", { name: "Deliver 2 selected holdings" }).click(); await expect(page.getByRole("button", { name: "Retry same stock batch" })).toBeVisible(); await page.reload();
 await expect(page.getByRole("button", { name: "Retry same stock batch" })).toBeVisible(); expect(deliveries).toHaveLength(1);
 await page.screenshot({ path: info.outputPath(`stock-batch-pending-${width}.png`), fullPage: true });
 expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
 await page.getByRole("button", { name: "Retry same stock batch" }).click(); await expect.poll(() => deliveries.length).toBe(2); expect(deliveries[1]).toEqual(deliveries[0]); await expect(page.getByRole("button", { name: "Retry same stock batch" })).toHaveCount(0);
});
