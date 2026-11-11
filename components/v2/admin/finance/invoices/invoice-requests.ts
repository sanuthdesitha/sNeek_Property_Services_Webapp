/**
 * The single-invoice requests the screen makes. Same endpoints and bodies the
 * old estate-invoices.tsx sent; collected here so dialogs and row actions do
 * not each rebuild them.
 */
export type RequestOutcome<TBody = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  body: TBody & { error?: string };
};

async function send<TBody>(url: string, init?: RequestInit): Promise<RequestOutcome<TBody>> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as TBody & { error?: string };
  return { ok: response.ok, status: response.status, body };
}

function json(method: "PATCH" | "POST", payload: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

export function patchInvoice<TBody = Record<string, unknown>>(id: string, payload: Record<string, unknown>) {
  return send<TBody>(`/api/admin/invoices/${id}`, json("PATCH", payload));
}

export function getInvoice<TBody>(id: string, signal?: AbortSignal) {
  return send<TBody>(`/api/admin/invoices/${id}`, { signal, cache: "no-store" });
}

export function deleteInvoiceRequest(id: string) {
  return send(`/api/admin/invoices/${id}`, { method: "DELETE" });
}

export function sendInvoiceRequest(id: string, to: string) {
  return send(`/api/admin/invoices/${id}/send`, json("POST", to ? { to } : {}));
}

export function pushInvoiceToXeroRequest(id: string) {
  return send<{ alreadyPushed?: boolean }>(`/api/admin/invoices/${id}/xero-push`, { method: "POST" });
}

export function reconcileInvoiceRequest(
  id: string,
  input: { reason: string; reference: string; security?: { pin?: string; password?: string } },
) {
  return send(
    `/api/admin/invoices/${id}/reconcile`,
    json("POST", { reason: input.reason, reference: input.reference, confirmedInXero: true, security: input.security }),
  );
}

export function pdfHref(id: string) {
  return `/api/admin/invoices/${id}/pdf?inline=1`;
}
