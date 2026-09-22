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
  await page.getByLabel("Stock item").selectOption("soap"); await page.getByLabel("Quantity to add").fill("3"); await page.getByRole("button", { name: "Record my stock" }).click();
  await expect(page.getByText("3 bottles(s) on hand")).toBeVisible();
  await page.getByRole("button", { name: "Set remaining quantity" }).click(); await page.getByLabel("Remaining quantity").fill("0"); await page.getByLabel("Reason for adjustment").fill("Used on today's cleaning"); await page.getByRole("button", { name: "Save remaining quantity" }).click();
  await expect(page.getByRole("button", { name: "Retry same stock entry" })).toBeVisible(); await page.reload();
  await expect(page.getByText("0 bottles(s) on hand")).toBeVisible(); await page.getByRole("button", { name: "Set remaining quantity" }).click();
  await page.getByRole("button", { name: "Retry same stock entry" }).click(); await expect.poll(() => patches.length).toBe(2); expect(patches[1]).toEqual(patches[0]);
  await expect(page.getByRole("button", { name: "Deliver", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`own-stock-${width}.png`), fullPage: true });
});
