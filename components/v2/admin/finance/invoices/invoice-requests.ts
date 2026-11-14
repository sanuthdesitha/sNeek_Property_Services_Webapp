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

export type SecurityCredentials = { pin?: string; password?: string };

/** Words for the server's security refusal codes (same wording as verifyAdminSecurity). */
export function securityRefusalMessage(error: string | undefined, fallback: string): string {
  if (error === "INVALID_SECURITY_VERIFICATION") return "That PIN was not accepted.";
  if (error === "PIN_OR_PASSWORD_REQUIRED") return "Enter your PIN.";
  if (error === "FORBIDDEN") return "You cannot do this here. Stop impersonating and sign in as yourself.";
  return error || fallback;
}

/** The PIN or password is verified by the server, not only by the dialog. */
export function deleteInvoiceRequest(id: string, security?: SecurityCredentials) {
  return send(`/api/admin/invoices/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ security: security ?? {} }),
  });
}

/** A DRAFT credit note against a sent invoice; answers with its id. */
export function createCreditNoteRequest(id: string, security?: SensitiveSecurity) {
  // A sensitive action (owner decision 2026-11-13): the server checks the PIN.
  return send<{ id?: string; invoiceNumber?: string; exceedsRemaining?: boolean; remaining?: number }>(
    `/api/admin/invoices/${encodeURIComponent(id)}/credit-note`,
    json("POST", { security: security ?? {} }),
  );
}

/** Own-PIN credentials as the shared prompt returns them (newPin only while setting one up). */
export type SensitiveSecurity = { pin?: string; password?: string; newPin?: string };

/** Void an invoice or a credit note: the reason and the own PIN go with it; the server verifies both. */
export function voidInvoiceRequest(id: string, security?: SensitiveSecurity, voidReason?: string) {
  return patchInvoice(id, { status: "VOID", voidReason, security: security ?? {} });
}

/** Why Void and Issue credit note are unavailable to someone without the capability. */
export const VOID_CREDIT_REFUSAL =
  "Void and credit notes is a sensitive action: it needs Finance at Full (or that grant) and your own PIN. Ask an administrator.";

/** A blank DRAFT for a client and period (yyyy-MM-dd days); answers with its id. */
export function createBlankInvoiceRequest(input: { clientId: string; periodStart: string; periodEnd: string }) {
  return send<{ id?: string; invoiceNumber?: string }>("/api/admin/invoices", json("POST", { kind: "BLANK", ...input }));
}

/** Send options are explicit; leaving them out keeps the old behaviour (no link, no push). */
export type SendRequestOptions = { includePaymentLink?: boolean; pushToXero?: boolean };

export function sendInvoiceRequest(id: string, to: string, options: SendRequestOptions = {}) {
  return send<{ paymentLink?: string; xeroPush?: { outcome: "pushed" | "already-pushed" | "failed"; error?: string } }>(
    `/api/admin/invoices/${id}/send`,
    json("POST", { ...(to ? { to } : {}), ...(options.includePaymentLink ? { includePaymentLink: true } : {}), ...(options.pushToXero ? { pushToXero: true } : {}) }),
  );
}

/** The draft client's finished, unbilled jobs with the generator's charge. */
export function getUnbilledJobs<TBody>(id: string, signal?: AbortSignal) {
  return send<TBody>(`/api/admin/invoices/${encodeURIComponent(id)}/jobs`, { signal, cache: "no-store" });
}

/** Add finished jobs to a draft, guarded by the version the page last read. */
export function addJobsRequest(id: string, jobIds: string[], expectedUpdatedAt: string) {
  return send<Record<string, unknown>>(`/api/admin/invoices/${encodeURIComponent(id)}/jobs`, json("POST", { jobIds, expectedUpdatedAt }));
}

export function getSavedItems<TBody>(signal?: AbortSignal) {
  return send<TBody>("/api/admin/invoices/saved-items", { signal, cache: "no-store" });
}

export function putSavedItems<TBody>(payload: { items: unknown[]; expectedUpdatedAt: string | null }) {
  return send<TBody>("/api/admin/invoices/saved-items", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

export function pushInvoiceToXeroRequest(id: string) {
  return send<{ alreadyPushed?: boolean }>(`/api/admin/invoices/${id}/xero-push`, { method: "POST" });
}

export function reconcileInvoiceRequest(
  id: string,
  input: { reason: string; reference: string; security?: SensitiveSecurity },
) {
  return send(
    `/api/admin/invoices/${id}/reconcile`,
    json("POST", { reason: input.reason, reference: input.reference, confirmedInXero: true, security: input.security }),
  );
}

export function pdfHref(id: string) {
  return `/api/admin/invoices/${id}/pdf?inline=1`;
}

/** The same PDF as an attachment download. */
export function pdfDownloadHref(id: string) {
  return `/api/admin/invoices/${id}/pdf`;
}

/** The editor page's read model (lines, checks, Xero, history). */
export function getInvoiceEditor<TBody>(id: string, signal?: AbortSignal) {
  return send<TBody>(`/api/admin/invoices/${encodeURIComponent(id)}?view=editor`, { signal, cache: "no-store" });
}
