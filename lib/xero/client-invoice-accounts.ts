/**
 * Which Xero account each line of a client invoice or credit note goes to
 * (2026-11-23). Plain module: no database, no Xero.
 *
 * Before: every client invoice, credit note and "Update in Xero" line was sent
 * with `line.accountCode || "200"`, the stored sales account defaulted to
 * "200" and an emptied one turned back into "200", so a push always reached
 * account 200 whatever 200 is in the organisation's chart. Now the accounts are
 * explicit settings (Settings › Money › Xero › Client invoices, stored with
 * the other Xero codes in `phase3_integrations_v1`):
 *
 * - Sales (required): cleaning services, extras billed on job lines, hand-added
 *   charges, discounts, and every line below whose own account is empty.
 * - Repairs (optional): repairs the client agreed to cover (MAINTENANCE lines).
 * - Shopping recharges (optional): shopping purchases recharged to the client
 *   and shopping time (SHOPPING_REIMBURSEMENT, SHOPPING_TIME).
 * - Credit notes (optional): every line of a credit note except agency
 *   disbursements; empty keeps each line on the account its kind uses.
 * - Agency disbursements (existing rule, unchanged): SHOPPING_DISBURSEMENT
 *   lines need their own balance-sheet account, different from sales.
 *
 * The optional accounts say on screen that, left empty, their lines use the
 * sales account. With no sales account the push, the credit note, "Update in
 * Xero" and the CSV exports are refused before anything is sent.
 *
 * Existing installs. The stored setting always carried a sales account of
 * "200" because every save wrote the default back, so a stored "200" cannot
 * be told apart from one the owner typed. It keeps working and is shown as
 * "currently used: 200 — confirm or change" until saved from the card
 * (`defaultAccountCodeConfirmed`). Any other stored code can only have been
 * typed, so it counts as chosen.
 */
import { XERO_ACCOUNT_CODE_PATTERN, cleanXeroAccountCode } from "./cleaner-bill-accounts";

export type ClientInvoiceAccountSettings = {
  /** The sales account (historic field name, kept so stored values keep working). */
  defaultAccountCode?: string | null;
  /** True once an administrator saved the sales account from the Client invoices card. */
  defaultAccountCodeConfirmed?: boolean | null;
  clientRepairsAccountCode?: string | null;
  clientShoppingAccountCode?: string | null;
  clientCreditNoteAccountCode?: string | null;
  disbursementAccountCode?: string | null;
};

export type ClientInvoiceLineKind = "SALES" | "REPAIRS" | "SHOPPING" | "DISBURSEMENT";

/** The value every save used to write when nothing was chosen. */
export const LEGACY_DEFAULT_SALES_ACCOUNT = "200";

export const CLIENT_INVOICE_ACCOUNT_REFUSAL =
  "Choose the Xero sales account for client invoices in Settings › Money › Xero before pushing. Nothing was sent to Xero.";

export const CLIENT_INVOICE_EXPORT_REFUSAL =
  "Choose the Xero sales account for client invoices in Settings › Money › Xero before exporting. Nothing was exported.";

export const DISBURSEMENT_ACCOUNT_REFUSAL =
  "Configure a separate balance-sheet disbursement account in Xero settings before exporting client agency purchases.";

export const CLIENT_INVOICE_LINE_KIND_LABEL: Record<ClientInvoiceLineKind, string> = {
  SALES: "Cleaning services and other charges",
  REPAIRS: "Repairs the client covers",
  SHOPPING: "Shopping recharges and shopping time",
  DISBURSEMENT: "Shopping agency disbursements",
};

/** The kind of one stored line, read from its category. */
export function clientInvoiceLineKind(category: string | null | undefined): ClientInvoiceLineKind {
  if (category === "SHOPPING_DISBURSEMENT") return "DISBURSEMENT";
  if (category === "SHOPPING_REIMBURSEMENT" || category === "SHOPPING_TIME") return "SHOPPING";
  if (category === "MAINTENANCE") return "REPAIRS";
  return "SALES";
}

export type ClientInvoiceAccounts = {
  sales: string;
  /** The stored "200" nobody has confirmed since the default was removed. */
  salesNeedsConfirmation: boolean;
  repairs: string;
  repairsOwn: boolean;
  shopping: string;
  shoppingOwn: boolean;
  /** Only when chosen; empty keeps credit note lines on their kind's account. */
  creditNote: string | null;
  /** Null when not chosen, or not usable (same as sales): disbursement lines are then refused. */
  disbursement: string | null;
};

export type ClientInvoiceAccountResolution = { ok: true; accounts: ClientInvoiceAccounts } | { ok: false; reason: string };

function usableCode(value: unknown): string {
  const code = cleanXeroAccountCode(value);
  return code && XERO_ACCOUNT_CODE_PATTERN.test(code) ? code : "";
}

/** True when the stored sales account is the old default nobody has confirmed. */
export function salesAccountNeedsConfirmation(settings: ClientInvoiceAccountSettings): boolean {
  const code = cleanXeroAccountCode(settings.defaultAccountCode);
  return code === LEGACY_DEFAULT_SALES_ACCOUNT && settings.defaultAccountCodeConfirmed !== true;
}

/** The accounts for client invoices, or the refusal when no usable sales account is stored. */
export function resolveClientInvoiceAccounts(settings: ClientInvoiceAccountSettings, refusal: string = CLIENT_INVOICE_ACCOUNT_REFUSAL): ClientInvoiceAccountResolution {
  const sales = usableCode(settings.defaultAccountCode);
  if (!sales) return { ok: false, reason: refusal };
  const repairs = usableCode(settings.clientRepairsAccountCode);
  const shopping = usableCode(settings.clientShoppingAccountCode);
  const creditNote = usableCode(settings.clientCreditNoteAccountCode);
  const disbursement = usableCode(settings.disbursementAccountCode);
  return {
    ok: true,
    accounts: {
      sales,
      salesNeedsConfirmation: salesAccountNeedsConfirmation(settings),
      repairs: repairs || sales,
      repairsOwn: Boolean(repairs),
      shopping: shopping || sales,
      shoppingOwn: Boolean(shopping),
      creditNote: creditNote || null,
      disbursement: disbursement && disbursement !== sales ? disbursement : null,
    },
  };
}

export type ClientInvoiceLineAccount = { ok: true; code: string } | { ok: false; reason: string };

/** The account of one line of a resolved invoice (a disbursement without its own account is refused). */
export function clientInvoiceLineAccount(kind: ClientInvoiceLineKind, accounts: ClientInvoiceAccounts, creditNote: boolean): ClientInvoiceLineAccount {
  if (kind === "DISBURSEMENT") {
    return accounts.disbursement ? { ok: true, code: accounts.disbursement } : { ok: false, reason: DISBURSEMENT_ACCOUNT_REFUSAL };
  }
  if (creditNote && accounts.creditNote) return { ok: true, code: accounts.creditNote };
  if (kind === "REPAIRS") return { ok: true, code: accounts.repairs };
  if (kind === "SHOPPING") return { ok: true, code: accounts.shopping };
  return { ok: true, code: accounts.sales };
}

export type ClientInvoiceAccountPlan = { ok: true; codes: string[]; accounts: ClientInvoiceAccounts } | { ok: false; reason: string };

/** The account code of every line, in order, or the first refusal (no sales account; a disbursement without its account). */
export function planClientInvoiceAccounts(
  categories: readonly (string | null | undefined)[],
  settings: ClientInvoiceAccountSettings,
  options: { creditNote?: boolean; refusal?: string } = {},
): ClientInvoiceAccountPlan {
  const resolved = resolveClientInvoiceAccounts(settings, options.refusal);
  if (!resolved.ok) return resolved;
  const codes: string[] = [];
  for (const category of categories) {
    const line = clientInvoiceLineAccount(clientInvoiceLineKind(category), resolved.accounts, Boolean(options.creditNote));
    if (!line.ok) return { ok: false, reason: line.reason };
    codes.push(line.code);
  }
  return { ok: true, codes, accounts: resolved.accounts };
}
