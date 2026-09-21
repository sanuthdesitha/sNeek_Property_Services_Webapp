import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/client/fixtures/laundry-redesign-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"test"}' }, alias: { "@": process.cwd(), "next/navigation": path.resolve("e2e/laundry/fixtures/responsive-navigation.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
for (const width of [320, 390, 1440]) test(`client laundry filters and expanded notes fit ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 850 });
  const task = { id: "task", status: "PICKED_UP", pickupDate: "2026-09-20T00:00:00Z", dropoffDate: null, updatedAt: "2026-09-21T00:00:00Z", property: { id: "property", name: "WaterfrontApartment".repeat(6), suburb: "Sydney" }, job: { id: "job", jobNumber: "JOB001", scheduledDate: "2026-09-20T00:00:00Z" }, confirmations: [{ id: "confirmation", createdAt: "2026-09-20T00:00:00Z", notes: JSON.stringify({ event: "PICKED_UP", bagCount: 3, note: "BagsCollectedFromTheSecureCupboard".repeat(8) }) }] };
  const requests: URL[] = [];
  await page.route("http://client-laundry.test/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/client/laundry") { requests.push(url); return route.fulfill({ json: [task] }); }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' });
  });
  await page.goto("http://client-laundry.test"); await page.evaluate(task => { (window as any).__laundryTasks = [task]; }, task);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await expect(page.getByText("Not scheduled", { exact: true })).toBeVisible();
  const fits = async () => expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, ...Array.from(document.querySelectorAll("main")).map(el => el.scrollWidth)) - innerWidth)).toBeLessThanOrEqual(1);
  await fits();
  await page.getByText("Updates, notes and photos", { exact: true }).click();
  await page.getByText("1 update · show details", { exact: true }).click();
  await expect(page.getByText(/Picked up — 3 bags/)).toBeVisible(); await fits();
  await page.getByRole("button", { name: "Custom dates" }).click();
  await page.getByLabel("Start date", { exact: true }).fill("2026-08-01"); await page.getByLabel("End date", { exact: true }).fill("2026-08-31");
  await page.getByLabel("Property", { exact: true }).selectOption("other"); await page.getByLabel("Status", { exact: true }).selectOption("PICKED_UP"); await page.getByLabel("Filter dates by").selectOption("dropoff");
  await expect.poll(() => Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({ propertyId: "other", status: "PICKED_UP", dateField: "dropoff", from: "2026-08-01", to: "2026-08-31" });
  await fits(); await page.screenshot({ path: info.outputPath(`client-laundry-${width}.png`), fullPage: true });
});
