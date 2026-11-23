/**
 * The invoice editor's "which account each kind of line goes to" (2026-11-23),
 * worked out with the same rules the push uses
 * (lib/xero/client-invoice-accounts.ts), plus each account's name from Xero
 * when it can be read (the cached read of `xeroAccountName`; a failure shows
 * its reason, never a guess). With no sales account the view carries the
 * refusal the push would answer.
 */
import {
  CLIENT_INVOICE_LINE_KIND_LABEL,
  clientInvoiceLineAccount,
  clientInvoiceLineKind,
  resolveClientInvoiceAccounts,
  type ClientInvoiceAccountSettings,
  type ClientInvoiceAccounts,
  type ClientInvoiceLineKind,
} from "@/lib/xero/client-invoice-accounts";
import type { EditorXeroAccountGroup, EditorXeroAccounts } from "./client-invoice-editor-types";
import { xeroAccountName, type XeroAccountName } from "./xero-account-name";

type AccountGroupDraft = Omit<EditorXeroAccountGroup, "name" | "nameReason">;

const KIND_ORDER: ClientInvoiceLineKind[] = ["SALES", "REPAIRS", "SHOPPING", "DISBURSEMENT"];

/** Why a kind uses another account, in words, or null when it uses its own. */
function fallbackNote(kind: ClientInvoiceLineKind, accounts: ClientInvoiceAccounts, creditNote: boolean): string | null {
  if (kind === "DISBURSEMENT") return null;
  if (creditNote && accounts.creditNote) return "Credit notes account";
  if (creditNote && kind === "SALES") return "No credit notes account chosen, so the sales account";
  if (kind === "REPAIRS" && !accounts.repairsOwn) return "No repairs account chosen, so the sales account";
  if (kind === "SHOPPING" && !accounts.shoppingOwn) return "No shopping account chosen, so the sales account";
  return null;
}

/** The groups shown on the card, in a fixed order; pure (no names read). */
export function clientInvoiceAccountGroups(
  categories: readonly (string | null | undefined)[],
  settings: ClientInvoiceAccountSettings,
  creditNote: boolean,
): { status: "not-set"; reason: string } | { status: "set"; groups: AccountGroupDraft[]; salesNeedsConfirmation: boolean; salesCode: string } {
  const resolved = resolveClientInvoiceAccounts(settings);
  if (!resolved.ok) return { status: "not-set", reason: resolved.reason };
  const counts = new Map<ClientInvoiceLineKind, number>();
  for (const category of categories) {
    const kind = clientInvoiceLineKind(category);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (counts.size === 0) counts.set("SALES", 0);
  const groups = KIND_ORDER.filter((kind) => counts.has(kind)).map((kind): AccountGroupDraft => {
    const account = clientInvoiceLineAccount(kind, resolved.accounts, creditNote);
    return {
      label: CLIENT_INVOICE_LINE_KIND_LABEL[kind],
      code: account.ok ? account.code : null,
      lines: counts.get(kind) ?? 0,
      fallback: account.ok ? fallbackNote(kind, resolved.accounts, creditNote) : null,
      refusal: account.ok ? null : account.reason,
    };
  });
  return { status: "set", groups, salesNeedsConfirmation: resolved.accounts.salesNeedsConfirmation, salesCode: resolved.accounts.sales };
}

/** The editor's accounts view, with each account's name from Xero when readable. */
export async function clientInvoiceAccountsView(
  categories: readonly (string | null | undefined)[],
  settings: ClientInvoiceAccountSettings,
  creditNote: boolean,
  readName: (code: string) => Promise<XeroAccountName> = xeroAccountName,
): Promise<EditorXeroAccounts> {
  try {
    const plan = clientInvoiceAccountGroups(categories, settings, creditNote);
    if (plan.status === "not-set") return plan;
    const groups = await Promise.all(
      plan.groups.map(async (group): Promise<EditorXeroAccountGroup> => {
        if (!group.code) return { ...group, name: null, nameReason: null };
        const named = await readName(group.code);
        return { ...group, name: named.name, nameReason: named.reason };
      }),
    );
    return { status: "set", groups, salesNeedsConfirmation: plan.salesNeedsConfirmation, salesCode: plan.salesCode };
  } catch (error) {
    return { status: "error", message: error instanceof Error && error.message ? error.message : "The Xero account settings could not be read." };
  }
}
