import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/laundry/fixtures/responsive-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "next-auth/react": path.resolve("e2e/laundry/fixtures/responsive-session.ts"), "next/navigation": path.resolve("e2e/laundry/fixtures/responsive-navigation.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
const longName = "WatersideApartments".repeat(6);
function task(status = "DROPPED") {
  const date = new Date().toISOString();
  return { id: "task-responsive", status, pickupDate: date, dropoffDate: date, droppedAt: date, bagWeightKg: 12, dropoffCostAud: 48, property: { id: "property", name: longName, suburb: "Sydney", address: "LongStreetAddress".repeat(8) }, supplier: { name: "Supplier".repeat(12) }, confirmations: [], job: { id: "job", scheduledDate: date } };
}
class LaundryScreen {
  constructor(readonly page: Page) {}
  async open(screen: string, width: number, empty = false) {
    this.page.on("pageerror", error => console.error(error.message)); await this.page.setViewportSize({ width, height: 780 });
    await this.page.route("http://laundry.test/**", async route => {
      const url = route.request().url();
      if (!url.includes("/api/")) return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' });
      if (url.includes("/options")) return route.fulfill({ json: { portalVisibility: {}, suppliers: [] } });
      if (url.includes("/attention-counts")) return route.fulfill({ json: {} });
      if (url.includes("/invoice/preview")) return route.fulfill({ json: { template: {}, data: { rows: empty ? [] : [{ ...task(), taskId: "task-responsive", propertyName: longName, serviceDate: new Date().toISOString(), amount: 48, notes: "Instructions".repeat(30) }], propertyBreakdown: [], totalAmount: 48 } } });
      return route.fulfill({ json: empty ? [] : [task(screen === "queue" || screen === "runs" || screen === "tracking" ? "CONFIRMED" : "DROPPED")] });
    });
    await this.page.goto(`http://laundry.test/?screen=${screen}`);
    await this.page.addStyleTag({ content: css });
    await this.page.addScriptTag({ content: bundle });
  }
  async fits() {
    await expect.poll(() => this.page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, ...Array.from(document.querySelectorAll("main")).map(el => el.scrollWidth)) - innerWidth)).toBeLessThanOrEqual(1);
  }
}
for (const width of [320, 390, 768, 1440]) {
  for (const screen of ["calendar", "history", "invoices", "queue", "runs", "tracking"]) {
    test(`${screen} fits ${width}px with long property and supplier names`, async ({ page }, info) => {
      const ui = new LaundryScreen(page); await ui.open(screen, width);
      await expect(page.getByText(longName, { exact: false }).filter({ visible: true }).first()).toBeVisible();
      await ui.fits();
      if (screen === "calendar") { await page.getByRole("button", { name: "Next month", exact: true }).click(); await ui.fits(); }
      if (screen === "history" && width < 768) {
        await page.getByRole("button", { name: "Edit completed task", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible(); await ui.fits();
        await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
      }
      if (width === 320) await page.screenshot({ path: info.outputPath(`${screen}-320.png`), fullPage: true });
    });
  }
}
test("empty history remains readable at 320px", async ({ page }) => {
  const ui = new LaundryScreen(page); await ui.open("history", 320, true);
  await expect(page.getByText("Completed and past laundry tasks will appear here.")).toBeVisible(); await ui.fits();
});
test("next stop access report and cancel remain reachable on a short phone", async ({ page }) => {
  const ui = new LaundryScreen(page); await ui.open("next-stop", 320);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Report access problem" }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await ui.fits();
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await cancel.scrollIntoViewIfNeeded(); await cancel.click(); await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("phone navigation exposes records and closes with Escape", async ({ page }) => {
  const ui = new LaundryScreen(page); await ui.open("history", 320, true);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Laundry navigation" });
  await expect(dialog.getByRole("link", { name: "History", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Invoices", exact: true })).toBeVisible(); await ui.fits();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
});
test("history failure remains readable and refreshable on a phone", async ({ page }) => {
  const ui = new LaundryScreen(page); await ui.open("history", 320, true);
  await page.route("**/api/laundry/history", route => route.fulfill({ status: 503, json: { error: "History temporarily unavailable. Try refreshing." } }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("History temporarily unavailable. Try refreshing.")).toBeVisible(); await ui.fits();
});
