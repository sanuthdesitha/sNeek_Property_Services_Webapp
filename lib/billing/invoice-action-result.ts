/**
 * The outcome of a client-invoice action, independent of HTTP.
 *
 * Single-invoice routes and the bulk route call the same action functions; the
 * single routes turn this into their response unchanged, and the bulk route
 * turns it into a per-row outcome. Keeping the status code lets both report the
 * exact refusal a guard gave.
 */
export type InvoiceActionBody = Record<string, unknown>;

export type InvoiceActionResult<TBody extends object = InvoiceActionBody> = {
  status: number;
  body: TBody;
};

export function actionResult<TBody extends object>(body: TBody, status = 200): InvoiceActionResult<TBody> {
  return { status, body };
}

export function isActionSuccess(result: InvoiceActionResult<object>): boolean {
  return result.status < 400;
}

/** The refusal message a guard gave, or a generic one. */
export function actionError(result: InvoiceActionResult<object>, fallback: string): string {
  const error = (result.body as InvoiceActionBody).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

/** The actor performing an invoice action: the effective session user. */
export type InvoiceActor = {
  id: string;
  role: string;
  name?: string | null;
  email?: string | null;
};
