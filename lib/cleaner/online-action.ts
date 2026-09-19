export class UnknownActionOutcome extends Error {
  constructor(detail?: string) { super(`${detail ? `${detail} ` : "The server response could not be confirmed. "}Check the latest status before trying again.`); }
}

/** These commands are never queued or replayed by the browser. */
export async function postOnlineAction(url: string, body: unknown = {}, headers: Record<string, string> = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("This action needs a connection. Reconnect and try again.");
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  } catch { throw new UnknownActionOutcome(); }
  let data: any;
  try { data = await response.json(); } catch { throw new UnknownActionOutcome(); }
  if (response.status >= 500 || !data || typeof data !== "object" || Array.isArray(data)) throw new UnknownActionOutcome();
  // Existing routes can report post-commit audit/delivery errors as 400.
  if (response.status === 400) throw new UnknownActionOutcome(typeof data.error === "string" ? data.error : undefined);
  if (!response.ok) {
    const error = new Error(data.error || "Request failed") as Error & { code?: string; data?: unknown };
    error.code = typeof data.code === "string" ? data.code : undefined;
    error.data = data;
    throw error;
  }
  if (data.ok !== true) throw new UnknownActionOutcome();
  return data;
}
