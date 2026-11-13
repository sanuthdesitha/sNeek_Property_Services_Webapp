import { ProviderCallError } from "../types";

const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Accepts plain JSON or one ```json fence. Anything else is INVALID_JSON (eligible for one repair). */
export function parseJsonText(text: string, failureMessage: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new ProviderCallError("INVALID_JSON", failureMessage);
  }
}

/** Retry-After in seconds or an HTTP date, capped at 10 seconds. */
export function retryAfterFromHeaders(headers: unknown): number | null {
  let raw: string | null = null;
  if (headers && typeof (headers as Headers).get === "function") raw = (headers as Headers).get("retry-after");
  else if (headers && typeof headers === "object") raw = String((headers as Record<string, unknown>)["retry-after"] ?? "") || null;
  if (!raw) return null;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 10_000) : null;
}

export function httpFailure(status: number, headers: Headers | null, message: string): ProviderCallError {
  if (status === 429) return new ProviderCallError("RATE_LIMITED", message, status, retryAfterFromHeaders(headers));
  if (status >= 500) return new ProviderCallError("SERVER", message, status, retryAfterFromHeaders(headers));
  if (status === 401 || status === 403) return new ProviderCallError("AUTH", message, status);
  return new ProviderCallError("BAD_REQUEST", message, status);
}

/** Reads at most 1 MB of a provider body. Never returns or logs the body on failure. */
export async function readBoundedJson(response: Response, message: string): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw httpFailure(response.status, response.headers, message);
  }
  if ((Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderCallError("INCOMPLETE", message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new ProviderCallError("INCOMPLETE", message);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof ProviderCallError) throw error;
    throw new ProviderCallError("CONNECTION", message);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderCallError("INCOMPLETE", message);
  }
}

export function fetchFailure(error: unknown, message: string): ProviderCallError {
  if (error instanceof ProviderCallError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return new ProviderCallError("TIMEOUT", message);
  return new ProviderCallError("CONNECTION", message);
}
