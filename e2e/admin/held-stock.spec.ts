import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/admin/fixtures/held-stock-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "next-auth/react": path.resolve("e2e/admin/fixtures/property-memory-session.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
for (const width of [390, 1440]) test(`grouped admin stock recovers a stale correction at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 800 });
  const item = { id: "soap", name: "Laundry and household cleaning soap", unit: "bottles", category: "Cleaning supplies" };
  let entries = [{ heldStockId: "a", quantity: 2, item, updatedAt: "2026-09-22T01:00:00.000Z", sourceNote: "First purchase" }, { heldStockId: "b", quantity: 3, item, updatedAt: "2026-09-22T01:00:00.000Z", sourceNote: "Second purchase" }];
  const patches: any[] = [];
  await page.route("http://localhost:3995/**", async route => {
    if (route.request().url().includes("/api/")) {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON(); patches.push(body);
        if (patches.length === 1) { entries[1] = { ...entries[1], quantity: 2, updatedAt: "2026-09-22T02:00:00.000Z" }; return route.fulfill({ status: 409, json: { error: "This holding changed. Refresh current stock." } }); }
        entries[1] = { ...entries[1], quantity: body.quantity, updatedAt: "2026-09-22T03:00:00.000Z" }; return route.fulfill({ json: { ok: true, id: "b", duplicated: false } });
      }
      return route.fulfill({ json: { byHolder: [{ holder: { id: "cleaner", name: "Alex", email: "a@test", role: "CLEANER" }, items: entries }] } });
    }
    return route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>` });
  });
  await page.goto("http://localhost:3995/");
  await expect(page.getByText("5 bottles total")).toBeVisible(); await expect(page.getByRole("heading", { name: item.name })).toHaveCount(1);
  await page.getByText("2 entries · edit or deliver").click(); await page.getByRole("button", { name: "Set remaining quantity" }).nth(1).click();
  await page.getByLabel("Remaining quantity").fill("1"); await page.getByLabel("Reason for adjustment").fill("Count checked by office"); await page.getByRole("button", { name: "Save remaining quantity" }).click();
  await expect(page.getByText("This holding changed. Refresh current stock.")).toBeVisible(); expect(patches).toHaveLength(1); expect(patches[0].heldStockId).toBe("b");
  await page.getByRole("button", { name: "Refresh stock", exact: true }).click(); await expect(page.getByText("4 bottles total")).toBeVisible();
  await page.getByText("2 entries · edit or deliver").click(); await page.getByLabel("Remaining quantity").fill("1"); await page.getByLabel("Reason for adjustment").fill("Rechecked after delivery"); await page.getByRole("button", { name: "Save remaining quantity" }).click();
  await expect(page.getByText("3 bottles total")).toBeVisible(); expect(patches[1].expectedUpdatedAt).toBe("2026-09-22T02:00:00.000Z"); expect(patches[1].requestId).not.toBe(patches[0].requestId); expect(entries[0].quantity).toBe(2);
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`admin-held-stock-${width}.png`), fullPage: true });
});
