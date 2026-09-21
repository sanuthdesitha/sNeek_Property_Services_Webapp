import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/admin/fixtures/property-memory-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "next-auth/react": path.resolve("e2e/admin/fixtures/property-memory-session.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
class MemoryPage {
  constructor(readonly page: Page) {}
  async choose() { await this.page.getByLabel("Property", { exact: true }).selectOption("p1"); }
  async fits() { expect(await this.page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1); }
}
for (const width of [320, 390, 1440]) test(`property memory review and explicit training are usable at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 780 });
  const property = { id: "p1", name: "HarbourApartments".repeat(5) };
  let excluded = false, queued = false, firstRead = true;
  const mutations: any[] = [];
  await page.route("http://localhost:3997/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/example.svg") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#93aba2"/></svg>' });
    if (url.pathname.includes("/api/")) {
      const method = route.request().method();
      if (method !== "GET") { const body = route.request().postDataJSON(); mutations.push({ method, body }); if (method === "PATCH") excluded = body.excluded; else queued = true; return route.fulfill({ json: { ok: true } }); }
      if (url.searchParams.has("q")) return route.fulfill({ json: { properties: [property] } });
      const empty = firstRead; firstRead = false;
      return route.fulfill({ json: { property, items: empty ? [] : [{ id: "m1", fieldId: "kitchen", fieldLabel: "Kitchen bench and appliances", sectionLabel: "Main kitchen", submittedAt: "2026-09-20T03:00:00Z", url: "/example.svg", excluded }], nextOffset: empty ? 60 : null, training: { status: queued ? "QUEUED" : "READY", modelVersion: "location-v3" }, modelConfigured: true, trainingEnabled: true } });
    }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  await page.goto("http://localhost:3997/memory"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  const ui = new MemoryPage(page); await ui.choose();
  await expect(page.getByText(/No valid labelled examples on this page/)).toBeVisible(); await page.getByRole("button", { name: "Load more examples" }).click();
  await expect(page.getByText("Main kitchen · Kitchen bench and appliances")).toBeVisible(); await ui.fits(); expect(mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Exclude example" }).click(); await page.getByLabel("Reason for this change").fill("This is the wrong room; keep the original evidence.");
  await page.getByRole("button", { name: "Confirm exclusion" }).click(); await expect(page.getByText("Excluded from memory")).toBeVisible(); expect(mutations[0]).toMatchObject({ method: "PATCH", body: { propertyId: "p1", mediaId: "m1", excluded: true } });
  await page.getByRole("button", { name: "Train / update model" }).click(); await expect(page.getByText("Status: QUEUED · Version location-v3")).toBeVisible(); expect(mutations[1]).toEqual({ method: "POST", body: { propertyId: "p1" } });
  await ui.fits(); await page.screenshot({ path: info.outputPath(`property-memory-${width}.png`), fullPage: true });
});
