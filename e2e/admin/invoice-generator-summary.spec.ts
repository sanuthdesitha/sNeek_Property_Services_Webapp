import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/admin/fixtures/invoice-generator-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"test"}' }, alias: { "@": process.cwd() } })).outputFiles[0].text;
});
test("invoice generator explains started work and reports the server inclusion counts", async ({ page }) => {
  page.on("pageerror", error => console.error("Fixture runtime:", error.message));
  const requests: unknown[] = []; let loads = 0;
  await page.route("**/api/admin/invoices", route => {
    loads++;
    return route.fulfill({ json: { clients: [{ id: "client-a", name: "First client", email: "first@example.invalid" }, { id: "client-b", name: "Selected client", email: "selected@example.invalid" }],
      properties: [{ id: "property-b", name: "Selected property", suburb: "Sydney", clientId: "client-b" }], rates: [], invoices: [] } });
  });
  await page.route("**/api/admin/invoices/generate", route => {
    expect(route.request().method()).toBe("POST"); requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: "synthetic-invoice", generationSummary: { includedJobCount: 7, alreadyInvoicedJobCount: 3 } } });
  });
  await page.route("**/__synthetic_invoice_generator", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><style>body{margin:12px;font-family:sans-serif}[role=dialog]{position:fixed;inset:3%;background:white;border:1px solid;padding:12px;overflow:auto}button,input,select{min-height:44px}input,select{max-width:95%}[role=dialog] label{display:block}svg{width:18px;height:18px}</style></head><body><div id="root"></div></body></html>' }));
  await page.goto("/__synthetic_invoice_generator"); await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "Generate invoice", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Includes jobs that have started or finished/)).toBeVisible();
  await expect(dialog.getByText(/work that has not started are excluded/)).toBeVisible();
  await dialog.getByRole("combobox").nth(0).selectOption("client-b");
  await expect(dialog.getByRole("combobox").nth(1)).toHaveValue("");
  await expect(dialog.getByRole("combobox").nth(1).locator("option:checked")).toHaveText("All properties");
  await dialog.locator('input[type="date"]').nth(0).fill("2026-09-01");
  await dialog.locator('input[type="date"]').nth(1).fill("2026-09-15");
  await dialog.getByRole("button", { name: "Generate draft invoice", exact: true }).click();
  await expect(page.getByText("Invoice draft created", { exact: true })).toBeVisible();
  await expect(page.getByText("7 job(s) included. 3 job(s) already on another non-void invoice, including drafts.", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(requests).toEqual([{ clientId: "client-b", periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-15T23:59:59.999Z", gstEnabled: true, periodBasis: "SCHEDULED" }]);
  await expect.poll(() => loads).toBe(2);
});
