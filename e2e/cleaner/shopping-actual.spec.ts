import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let bundle: string;
test.beforeAll(async () => { bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/shopping-actual-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd() }, logLevel: "silent" })).outputFiles[0].text; });
class ShoppingPage {
  constructor(readonly page: Page) {}
  async open() {
    await this.page.route("**/__shopping", route => route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div></body></html>' }));
    await this.page.goto("/__shopping"); await this.page.evaluate(() => { (window as any).process = { env: {} }; }); await this.page.addScriptTag({ content: bundle }); await this.page.evaluate(() => (window as any).__mountShopping());
  }
  async addCatalogue() {
    await this.page.getByLabel("Catalogue item or custom purchase").selectOption("soap");
    await this.page.getByLabel("Purchased quantity").fill("3");
    await this.page.getByLabel("Purchase unit cost").fill("4.50");
    await this.page.getByRole("button", { name: "Add actual purchase" }).click();
  }
}
test("general shopping records actual items and preserves edits after a failed save", async ({ page }) => {
  let writes = 0; let posted: any;
  const run = { id: "run", name: "General shopping", ownerScope: "CLEANER", ownerName: "Cleaner", planningScope: "general", status: "IN_PROGRESS", rows: [], payment: { method: "COMPANY_CARD", paidByScope: "COMPANY", receipts: [] }, catalogItems: [{ id: "soap", name: "Hand soap", category: "Cleaning", unit: "bottle", supplier: "Shop" }] };
  await page.route("**/api/cleaner/inventory/shopping-runs/run", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: run });
    posted = route.request().postDataJSON(); writes++;
    return writes === 1 ? route.fulfill({ status: 500, json: { error: "Save unavailable" } }) : route.fulfill({ json: { ...run, ...posted } });
  });
  const fixture = new ShoppingPage(page); await fixture.open(); await fixture.addCatalogue();
  await page.getByRole("button", { name: "Save draft" }).click(); await expect.poll(() => writes).toBe(1);
  await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
  await page.getByRole("button", { name: "Save draft" }).click(); await expect.poll(() => writes).toBe(2);
  expect(posted.rows).toEqual([expect.objectContaining({ propertyId: "", itemId: "soap", plannedQty: 0, purchased: true, actualPurchasedQty: 3, actualLineCost: 13.5 })]);
  await page.getByRole("button", { name: "Submit run" }).click();
  expect(writes).toBe(2); // Time and attached receipt are still mandatory.
});
