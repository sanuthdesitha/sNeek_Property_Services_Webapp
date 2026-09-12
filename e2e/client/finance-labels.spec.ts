import { test, expect } from "../fixtures/local-client";
import type { Page } from "@playwright/test";

test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
test.setTimeout(180_000);

class ClientFinancePage {
  constructor(private page: Page) {}
  async open() { await this.page.goto("/v2/client/finance"); }
  estimateExplanation() { return this.page.getByText(/Unbilled services are estimates from the latest 50 completed jobs/); }
  invoiceLink(number: string) { return this.page.getByRole("link", { name: number, exact: true }); }
}

test("client finance labels history limits and opens only its issued invoice", async ({ localClient }) => {
  const { page, db, clientId, id } = localClient;
  const invoiceNumber = `${id}-invoice`;
  await db.clientInvoice.create({ data: { clientId, invoiceNumber, status: "PAID", totalAmount: 120, paidAmount: 120 } });
  const finance = new ClientFinancePage(page);
  await finance.open();
  await expect(finance.estimateExplanation()).toBeVisible();
  await expect(page.getByText("latest 20 invoices, including paid", { exact: true })).toBeVisible();
  await expect(page.getByText("Payment recorded", { exact: true })).toBeVisible();
  await finance.invoiceLink(invoiceNumber).click();
  await expect(page.getByRole("heading", { name: invoiceNumber, exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Invoices", exact: true }).click();
  await expect(finance.estimateExplanation()).toBeVisible();
});
