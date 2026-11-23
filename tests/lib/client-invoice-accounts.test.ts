/**
 * Xero accounts of client invoices and credit notes (2026-11-23): refused with
 * nothing chosen (never "200"), the chosen account used, each optional kind
 * falling back to sales, the credit notes account, the unchanged disbursement
 * rule, and how a stored legacy "200" is treated.
 */
import { describe, expect, it } from "vitest";
import {
  CLIENT_INVOICE_ACCOUNT_REFUSAL,
  CLIENT_INVOICE_EXPORT_REFUSAL,
  clientInvoiceLineKind,
  planClientInvoiceAccounts,
  resolveClientInvoiceAccounts,
  salesAccountNeedsConfirmation,
} from "@/lib/xero/client-invoice-accounts";
import { clientInvoiceAccountGroups, clientInvoiceAccountsView } from "@/lib/billing/client-invoice-xero-accounts-view";
import { buildXeroLineItems } from "@/lib/billing/client-invoice-xero-lines";

const categories = ["SERVICE", "MAINTENANCE", "SHOPPING_REIMBURSEMENT", "SHOPPING_TIME", "DISCOUNT", "SHOPPING_DISBURSEMENT"];

describe("client invoice accounts", () => {
  it("refuses when no sales account is stored, whatever the optional accounts say", () => {
    expect(resolveClientInvoiceAccounts({})).toEqual({ ok: false, reason: CLIENT_INVOICE_ACCOUNT_REFUSAL });
    expect(resolveClientInvoiceAccounts({ defaultAccountCode: "  ", clientShoppingAccountCode: "4200" })).toMatchObject({ ok: false });
    expect(resolveClientInvoiceAccounts({ defaultAccountCode: "bad code!" })).toMatchObject({ ok: false });
    expect(resolveClientInvoiceAccounts({}, CLIENT_INVOICE_EXPORT_REFUSAL)).toEqual({ ok: false, reason: CLIENT_INVOICE_EXPORT_REFUSAL });
  });

  it("uses the sales account for every kind when only it is set (disbursements still need their own)", () => {
    const plan = planClientInvoiceAccounts(categories.slice(0, 5), { defaultAccountCode: "4000" });
    expect(plan.ok && plan.codes).toEqual(["4000", "4000", "4000", "4000", "4000"]);
    expect(planClientInvoiceAccounts(categories, { defaultAccountCode: "4000" })).toMatchObject({ ok: false, reason: expect.stringContaining("separate balance-sheet") });
    expect(planClientInvoiceAccounts(["SHOPPING_DISBURSEMENT"], { defaultAccountCode: "4000", disbursementAccountCode: "4000" })).toMatchObject({ ok: false });
  });

  it("sends repairs, shopping and disbursements to their own accounts when chosen", () => {
    const settings = { defaultAccountCode: "4000", clientRepairsAccountCode: "4100", clientShoppingAccountCode: "4200", disbursementAccountCode: "820" };
    const plan = planClientInvoiceAccounts(categories, settings);
    expect(plan.ok && plan.codes).toEqual(["4000", "4100", "4200", "4200", "4000", "820"]);
  });

  it("puts a credit note's lines on the credit notes account when chosen, keeping disbursements on theirs", () => {
    const settings = { defaultAccountCode: "4000", clientRepairsAccountCode: "4100", clientCreditNoteAccountCode: "4900", disbursementAccountCode: "820" };
    const credit = planClientInvoiceAccounts(categories, settings, { creditNote: true });
    expect(credit.ok && credit.codes).toEqual(["4900", "4900", "4900", "4900", "4900", "820"]);
    const withoutOwn = planClientInvoiceAccounts(categories, { ...settings, clientCreditNoteAccountCode: "" }, { creditNote: true });
    expect(withoutOwn.ok && withoutOwn.codes).toEqual(["4000", "4100", "4000", "4000", "4000", "820"]);
  });

  it("reads the line kind from the stored category", () => {
    expect(categories.map(clientInvoiceLineKind)).toEqual(["SALES", "REPAIRS", "SHOPPING", "SHOPPING", "SALES", "DISBURSEMENT"]);
  });

  it("keeps a stored legacy 200 working but asks for confirmation; any other stored code counts as chosen", () => {
    expect(salesAccountNeedsConfirmation({ defaultAccountCode: "200" })).toBe(true);
    expect(salesAccountNeedsConfirmation({ defaultAccountCode: "200", defaultAccountCodeConfirmed: true })).toBe(false);
    expect(salesAccountNeedsConfirmation({ defaultAccountCode: "4000" })).toBe(false);
    expect(salesAccountNeedsConfirmation({ defaultAccountCode: "" })).toBe(false);
    const legacy = resolveClientInvoiceAccounts({ defaultAccountCode: "200" });
    expect(legacy).toMatchObject({ ok: true, accounts: { sales: "200", salesNeedsConfirmation: true } });
  });
});

describe("push lines", () => {
  const line = (category: string, description: string) => ({ description, quantity: 1, unitPrice: 10, lineTotal: 10, category, note: null, job: null, property: null });

  it("refuses to build lines with no sales account and maps each kind when set", () => {
    expect(() => buildXeroLineItems([line("SERVICE", "Clean")], { defaultAccountCode: "" }, undefined)).toThrow(CLIENT_INVOICE_ACCOUNT_REFUSAL);
    const items = buildXeroLineItems([line("SERVICE", "Clean"), line("SHOPPING_TIME", "Shopping time")], { defaultAccountCode: "4000", clientShoppingAccountCode: "4200" }, undefined);
    expect(items.map((item) => item.accountCode)).toEqual(["4000", "4200"]);
    const credit = buildXeroLineItems([line("SERVICE", "Clean")], { defaultAccountCode: "4000", clientCreditNoteAccountCode: "4900" }, undefined, { creditNote: true });
    expect(credit[0].accountCode).toBe("4900");
  });
});

describe("the invoice editor's accounts view", () => {
  it("says not chosen with the refusal when no sales account is stored", async () => {
    expect(await clientInvoiceAccountsView(["SERVICE"], {}, false, async () => ({ name: "never read", reason: null }))).toEqual({ status: "not-set", reason: CLIENT_INVOICE_ACCOUNT_REFUSAL });
  });

  it("lists each kind on the invoice with its account, the fallback in words and a missing disbursement account", () => {
    const view = clientInvoiceAccountGroups(["SERVICE", "SERVICE", "MAINTENANCE", "SHOPPING_DISBURSEMENT"], { defaultAccountCode: "200" }, false);
    expect(view).toMatchObject({ status: "set", salesNeedsConfirmation: true, salesCode: "200" });
    if (view.status !== "set") return;
    expect(view.groups).toEqual([
      { label: "Cleaning services and other charges", code: "200", lines: 2, fallback: null, refusal: null },
      { label: "Repairs the client covers", code: "200", lines: 1, fallback: "No repairs account chosen, so the sales account", refusal: null },
      { label: "Shopping agency disbursements", code: null, lines: 1, fallback: null, refusal: expect.stringContaining("separate balance-sheet") },
    ]);
  });

  it("reads each account's name and keeps the reason when it cannot", async () => {
    const view = await clientInvoiceAccountsView(["SERVICE"], { defaultAccountCode: "4000", defaultAccountCodeConfirmed: true }, false, async () => ({ name: null, reason: "Xero is not connected." }));
    expect(view).toMatchObject({ status: "set", salesNeedsConfirmation: false, groups: [{ code: "4000", name: null, nameReason: "Xero is not connected." }] });
  });
});
