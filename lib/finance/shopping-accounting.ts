import {
  CLIENT_INVOICE_ACCOUNT_REFUSAL,
  clientInvoiceLineAccount,
  clientInvoiceLineKind,
  resolveClientInvoiceAccounts,
  type ClientInvoiceAccountSettings,
} from "@/lib/xero/client-invoice-accounts";

export const isShoppingDisbursement = (category: string | null | undefined) => category === "SHOPPING_DISBURSEMENT";
export function invoiceOperatingRevenue(invoice: { totalAmount: number; lines: { category: string; lineTotal: number }[] }) {
  return Number((invoice.totalAmount - invoice.lines.filter(line => isShoppingDisbursement(line.category)).reduce((sum, line) => sum + line.lineTotal, 0)).toFixed(2));
}

export type ShoppingXeroMappingSettings = ClientInvoiceAccountSettings & { salesTaxType?: string };

/**
 * The Xero account and tax type of one client invoice line. Since 2026-11-23
 * the account comes from Settings › Money › Xero › Client invoices
 * (lib/xero/client-invoice-accounts.ts): with no sales account this throws the
 * refusal instead of using "200". Agency disbursements keep their own
 * balance-sheet account and BAS Excluded, as before.
 */
export function shoppingXeroMapping(
  category: string,
  settings: ShoppingXeroMappingSettings,
  defaultTaxType?: string,
  options: { creditNote?: boolean; refusal?: string } = {},
) {
  const resolved = resolveClientInvoiceAccounts(settings, options.refusal ?? CLIENT_INVOICE_ACCOUNT_REFUSAL);
  if (!resolved.ok) throw new Error(resolved.reason);
  const kind = clientInvoiceLineKind(category);
  const account = clientInvoiceLineAccount(kind, resolved.accounts, Boolean(options.creditNote));
  if (!account.ok) throw new Error(account.reason);
  if (kind === "DISBURSEMENT") return { accountCode: account.code, taxType: "BASEXCLUDED" };
  return { accountCode: account.code, taxType: defaultTaxType === "NONE" ? "NONE" : settings.salesTaxType?.trim() || defaultTaxType };
}
