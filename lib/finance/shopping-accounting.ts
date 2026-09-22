export const isShoppingDisbursement = (category: string | null | undefined) => category === "SHOPPING_DISBURSEMENT";
export function invoiceOperatingRevenue(invoice: { totalAmount: number; lines: { category: string; lineTotal: number }[] }) {
  return Number((invoice.totalAmount - invoice.lines.filter(line => isShoppingDisbursement(line.category)).reduce((sum, line) => sum + line.lineTotal, 0)).toFixed(2));
}
export function shoppingXeroMapping(category: string, settings: { defaultAccountCode: string; disbursementAccountCode?: string; salesTaxType?: string }, defaultTaxType?: string) {
  const salesAccountCode = settings.defaultAccountCode.trim() || "200";
  if (isShoppingDisbursement(category)) {
    const accountCode = settings.disbursementAccountCode?.trim();
    if (!accountCode || accountCode === salesAccountCode) throw new Error("Configure a separate balance-sheet disbursement account in Xero settings before exporting client agency purchases.");
    return { accountCode, taxType: "BASEXCLUDED" };
  }
  return { accountCode: salesAccountCode, taxType: defaultTaxType === "NONE" ? "NONE" : settings.salesTaxType?.trim() || defaultTaxType };
}
