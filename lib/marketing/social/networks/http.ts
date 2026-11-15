import "server-only";

/**
 * The one HTTP layer the social network clients use (2026-11-17). Injected,
 * so tests and the local browser check never reach a real network. Tokens
 * travel in the Authorization header or a form body, never in a URL, and
 * nothing here logs a request or a response.
 */

export type HttpRequest = {
  method: "GET" | "POST" | "DELETE";
  url: string;
  /** Sent as application/x-www-form-urlencoded. */
  form?: Record<string, string>;
  bearer?: string;
};

export type HttpResponse = { status: number; json: unknown };

export class HttpTransportError extends Error {
  /** True when the request may have reached the network (timed out waiting for the answer). */
  constructor(public mayHaveArrived: boolean, message: string) {
    super(message);
    this.name = "HttpTransportError";
  }
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

export const realHttpClient: HttpClient = async (request) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (request.bearer) headers.Authorization = `Bearer ${request.bearer}`;
    let body: string | undefined;
    if (request.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(request.form).toString();
    }
    const response = await fetch(request.url, { method: request.method, headers, body, signal: controller.signal, redirect: "error", cache: "no-store" });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new HttpTransportError(timedOut, timedOut ? "The network did not answer within 30 seconds." : "The network could not be reached.");
  } finally {
    clearTimeout(timer);
  }
};

const OPAQUE = /[A-Za-z0-9_\-]{32,}/g;

/** One line, no tokens or long opaque strings, at most 240 characters. */
export function sanitizeNetworkText(text: unknown): string {
  const value = typeof text === "string" ? text : "";
  return value
    .replace(/access_token=[^&\s]+/gi, "access_token=[removed]")
    .replace(/Bearer\s+\S+/gi, "Bearer [removed]")
    .replace(OPAQUE, "[removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
