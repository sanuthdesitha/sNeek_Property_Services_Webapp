/**
 * Links between the client-invoice list and the invoice editor page.
 *
 * The list keeps its filters, sort and page in its query string. Opening an
 * invoice carries that query in `back`, so the editor's "Client invoices" link
 * returns to the same view. Only the list's own keys are carried, and the list
 * validates every value again when it reads them. Pure: no "use client", so the
 * server page can call it.
 */
export const INVOICE_LIST_BASE = "/v2/admin/finance";

const LIST_KEYS = ["status", "client", "from", "to", "xero", "q", "sort", "dir", "page"] as const;
const MAX_VALUE_LENGTH = 100;

export function invoiceEditorPath(id: string): string {
  return `${INVOICE_LIST_BASE}/invoices/${encodeURIComponent(id)}`;
}

/** The editor URL, remembering the list view it was opened from. */
export function invoiceEditorHref(id: string, listQuery?: string | null): string {
  const query = (listQuery ?? "").replace(/^\?/, "");
  return query ? `${invoiceEditorPath(id)}?back=${encodeURIComponent(query)}` : invoiceEditorPath(id);
}

/** The list URL to return to: the remembered view, or the plain list for old deep links. */
export function invoiceListHref(back: string | string[] | null | undefined): string {
  const raw = Array.isArray(back) ? back[0] : back;
  const next = new URLSearchParams({ tab: "invoices" });
  if (raw) {
    const remembered = new URLSearchParams(raw);
    for (const key of LIST_KEYS) {
      const value = remembered.get(key);
      if (value && value.length <= MAX_VALUE_LENGTH) next.set(key, value);
    }
  }
  return `${INVOICE_LIST_BASE}?${next.toString()}`;
}
