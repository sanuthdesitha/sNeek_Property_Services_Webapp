import { expect, it } from "vitest";
import { invoiceOperatingRevenue, shoppingXeroMapping } from "@/lib/finance/shopping-accounting";
it("excludes client agency disbursements from income but retains shopping time and ordinary recharge", () => {
  expect(invoiceOperatingRevenue({ totalAmount: 165, lines: [{ category: "SHOPPING_DISBURSEMENT", lineTotal: 100 }, { category: "SHOPPING_TIME", lineTotal: 55 }, { category: "SHOPPING_REIMBURSEMENT", lineTotal: 10 }] })).toBe(65);
});
it("maps agency amounts to a separately configured balance-sheet account and BAS Excluded", () => {
  expect(shoppingXeroMapping("SHOPPING_DISBURSEMENT", { defaultAccountCode: "200", disbursementAccountCode: "800" })).toEqual({ accountCode: "800", taxType: "BASEXCLUDED" });
  expect(shoppingXeroMapping("SHOPPING_TIME", { defaultAccountCode: "200", salesTaxType: "OUTPUT" })).toEqual({ accountCode: "200", taxType: "OUTPUT" });
});
it.each(["", "200"])("does not silently map disbursements into sales: %s", disbursementAccountCode => {
  expect(() => shoppingXeroMapping("SHOPPING_DISBURSEMENT", { defaultAccountCode: "200", disbursementAccountCode })).toThrow("separate balance-sheet");
});

it("validates agency accounts against the effective sales fallback", () => {
 expect(() => shoppingXeroMapping("SHOPPING_DISBURSEMENT", { defaultAccountCode: " ", disbursementAccountCode: "200" })).toThrow("separate balance-sheet");
});
it("preserves invoice no-GST treatment despite configured sales tax", () => {
 expect(shoppingXeroMapping("SHOPPING_TIME", { defaultAccountCode: "200", salesTaxType: "OUTPUT" }, "NONE")).toEqual({ accountCode: "200", taxType: "NONE" });
 expect(shoppingXeroMapping("SHOPPING_DISBURSEMENT", { defaultAccountCode: "200", disbursementAccountCode: "800", salesTaxType: "OUTPUT" }, "NONE").taxType).toBe("BASEXCLUDED");
});
