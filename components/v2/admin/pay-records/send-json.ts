/**
 * One JSON request for a pay record action. An HTTP error is a failure even
 * though fetch resolved; the server's reason is returned in words (credential
 * codes through sensitiveVerificationText), never a raw status alone.
 */
import { sensitiveVerificationText } from "@/lib/security/pin-rules";

export type SendResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code: string | null };

export async function sendJson<T = Record<string, unknown>>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, signal?: AbortSignal): Promise<SendResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, data: data as T };
    const error = typeof data.error === "string" && data.error ? sensitiveVerificationText(data.error) : `The request was refused (${response.status}).`;
    return { ok: false, status: response.status, error, code: typeof data.code === "string" ? data.code : null };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, error: "Could not reach the server.", code: null };
  }
}
