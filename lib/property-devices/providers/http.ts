import "server-only";
/**
 * The single outbound path for device providers (2026-11-20).
 *
 * Every request is checked against an explicit allow-list of method + exact
 * URL (fixed hostnames, no query-built paths), then against the shared SSRF
 * rule (lib/security/ssrf.ts: https only, public addresses), with a timeout
 * and a short backoff on 429 / 5xx / network errors. Anything not on the list
 * throws before a socket is opened. Tests assert no other path is requested.
 *
 * Errors carry words, never tokens: response bodies are not copied into
 * messages, and headers are never logged.
 */
import { assertSafePublicUrl } from "@/lib/security/ssrf";

export type AllowedRequest = { method: "GET" | "POST"; url: string; purpose: string };

/**
 * Ring (unofficial, read-only). Shapes follow the open-source ring-client-api
 * (github.com/dgreif/ring, packages/ring-client-api/rest-client.ts and api.ts,
 * read 2026-11-20): the OAuth token endpoint, the client session the app API
 * requires before device reads, the device list and the location list.
 * Nothing here can read video, snapshots, live view or history, or change any
 * setting: those endpoints are simply not on the list.
 */
export const RING_ALLOWED: readonly AllowedRequest[] = [
  { method: "POST", url: "https://oauth.ring.com/oauth/token", purpose: "Sign in with the shared account or renew the sign-in" },
  { method: "POST", url: "https://api.ring.com/clients_api/session", purpose: "Open the app session Ring requires before device reads" },
  { method: "GET", url: "https://api.ring.com/clients_api/ring_devices", purpose: "List devices with battery and connection" },
  { method: "GET", url: "https://api.ring.com/devices/v1/locations", purpose: "List the account's locations" },
];

/**
 * Minut (official API v8). Token: developer.minut.com/authentication/user
 * (client_credentials with HTTP Basic client id/secret, read 2026-11-20).
 * Homes and devices: the v8 resources used by the open-source Minut client
 * pypoint (github.com/fredrike/pypoint, const.py: /v8/homes, /v8/devices).
 */
export const MINUT_ALLOWED: readonly AllowedRequest[] = [
  { method: "POST", url: "https://api.minut.com/v8/oauth/token", purpose: "Get an access token with the API client id and secret" },
  { method: "GET", url: "https://api.minut.com/v8/users/me", purpose: "Check the token works" },
  { method: "GET", url: "https://api.minut.com/v8/homes", purpose: "List homes" },
  { method: "GET", url: "https://api.minut.com/v8/devices", purpose: "List devices with battery" },
];

export const ALL_ALLOWED: readonly AllowedRequest[] = [...RING_ALLOWED, ...MINUT_ALLOWED];

export class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number | null, readonly kind: "auth" | "transient" | "refused" | "not_allowed" | "two_factor") {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export type ProviderFetchDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Defaults to the SSRF check; tests inject a no-op. */
  checkUrl: (url: string) => Promise<unknown>;
  timeoutMs: number;
};

export function defaultFetchDeps(): ProviderFetchDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    checkUrl: assertSafePublicUrl,
    timeoutMs: 15_000,
  };
}

const BACKOFF_MS = [1_000, 4_000];

export function assertAllowed(method: string, url: string): AllowedRequest {
  const match = ALL_ALLOWED.find((entry) => entry.method === method && entry.url === url);
  if (!match) throw new ProviderHttpError(`Blocked: ${method} ${new URL(url).host}${new URL(url).pathname} is not on the read-only list.`, null, "not_allowed");
  return match;
}

/** One allow-listed request with timeout and backoff. Returns the response for the caller to read. */
export async function providerFetch(deps: ProviderFetchDeps, method: "GET" | "POST", url: string, init: { headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  assertAllowed(method, url);
  await deps.checkUrl(url);
  let lastError: ProviderHttpError | null = null;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    if (attempt > 0) await deps.sleep(BACKOFF_MS[attempt - 1]);
    let response: Response;
    try {
      response = await deps.fetch(url, { method, headers: init.headers, body: init.body, redirect: "error", signal: AbortSignal.timeout(deps.timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      lastError = new ProviderHttpError(timedOut ? `No answer from ${new URL(url).host} within ${Math.round(deps.timeoutMs / 1000)} seconds.` : `Could not reach ${new URL(url).host}.`, null, "transient");
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = new ProviderHttpError(`${new URL(url).host} answered ${response.status}${response.status === 429 ? " (too many requests)" : " (a problem on their side)"}.`, response.status, "transient");
      continue;
    }
    return response;
  }
  throw lastError ?? new ProviderHttpError("The request failed.", null, "transient");
}

/** Read a JSON body; an unreadable body is an error in words, never the raw text. */
export async function readJson(response: Response, what: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProviderHttpError(`${what}: the answer was not in the expected format. The provider may have changed it.`, response.status, "refused");
  }
}
