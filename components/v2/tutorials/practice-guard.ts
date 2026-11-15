/**
 * Practice mode's network guard. While a practice screen is mounted, nothing
 * that could write leaves the browser:
 *
 * - fetch with any method other than GET/HEAD is answered locally (423, a
 *   "Practice" message) and never reaches the server — this covers Next server
 *   actions too, which are POSTs;
 * - XMLHttpRequest writes, navigator.sendBeacon and native form posts are
 *   stopped the same way;
 * - reads of practice records (ids starting "practice-") and the practice
 *   screen's own fixtures are answered from sample data in the browser;
 * - location is never requested (a practice check-in uses no location).
 *
 * Other reads go through unchanged: they change nothing. The one write that
 * passes is the person's OWN tutorial progress (/api/me/tours), which is the
 * tutorial layer's record, not business data. Every stopped request is listed
 * in `blocked` (tests read it).
 */

export type PracticeFixture = {
  /** Matches the request path (and query) for GET requests. */
  match: RegExp;
  body: unknown;
};

export type BlockedRequest = { method: string; url: string; via: "fetch" | "xhr" | "beacon" | "form" };

export const PRACTICE_REFUSAL = "Practice: nothing was sent or saved.";

const SAFE_METHODS = new Set(["GET", "HEAD"]);
/** The tutorial layer's own progress routes (the person's tour progress only). */
const TUTORIAL_PROGRESS = /^\/api\/me\/tours(\/preference)?(\?|$)/;

type Installed = {
  uninstall: () => void;
  blocked: BlockedRequest[];
};

let active: Installed | null = null;

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const fromInit = init?.method;
  const fromRequest = typeof Request !== "undefined" && input instanceof Request ? input.method : undefined;
  return (fromInit ?? fromRequest ?? "GET").toUpperCase();
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function pathAndQuery(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-Practice": "1" } });
}

export function practiceBlockedRequests(): readonly BlockedRequest[] {
  return active?.blocked ?? [];
}

export function isPracticeGuardActive(): boolean {
  return active !== null;
}

/**
 * Install the guard. Returns an uninstall function; installing again while a
 * guard is active replaces its fixtures but keeps a single patch.
 */
export function installPracticeGuard(fixtures: PracticeFixture[] = []): () => void {
  if (active) active.uninstall();
  const blocked: BlockedRequest[] = [];
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalBeacon = typeof navigator.sendBeacon === "function" ? navigator.sendBeacon : null;
  const geolocation = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
  const originalGetPosition = geolocation?.getCurrentPosition;
  const originalWatch = geolocation?.watchPosition;

  const guardedFetch: typeof fetch = async (input, init) => {
    const method = requestMethod(input, init);
    const url = requestUrl(input);
    const path = pathAndQuery(url);
    if (!SAFE_METHODS.has(method) && TUTORIAL_PROGRESS.test(path)) return originalFetch(input, init);
    if (!SAFE_METHODS.has(method)) {
      blocked.push({ method, url: path, via: "fetch" });
      // 423, not 409: several screens read 409 as "may have been recorded"; a practice refusal is certain.
      return jsonResponse(423, { error: PRACTICE_REFUSAL, practice: true });
    }
    const fixture = fixtures.find((entry) => entry.match.test(path));
    if (fixture) return jsonResponse(200, fixture.body);
    if (/[/=]practice-[A-Za-z0-9-]+/.test(path)) return jsonResponse(404, { error: "Practice sample: there is nothing more to load.", practice: true });
    return originalFetch(input, init);
  };
  window.fetch = guardedFetch;

  const xhrMethods = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  XMLHttpRequest.prototype.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    xhrMethods.set(this, { method: String(method).toUpperCase(), url: String(url) });
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const info = xhrMethods.get(this);
    if (info && !SAFE_METHODS.has(info.method)) {
      blocked.push({ method: info.method, url: pathAndQuery(info.url), via: "xhr" });
      this.abort();
      this.dispatchEvent(new ProgressEvent("error"));
      return;
    }
    return originalSend.call(this, body);
  };

  if (originalBeacon) {
    navigator.sendBeacon = (url: string | URL) => {
      blocked.push({ method: "POST", url: pathAndQuery(String(url)), via: "beacon" });
      return false;
    };
  }

  const onSubmit = (event: SubmitEvent) => {
    const form = event.target as HTMLFormElement | null;
    const method = (form?.getAttribute("method") ?? "get").toUpperCase();
    // React forms call preventDefault themselves; only a native post would leave the page.
    if (form && method !== "GET" && !event.defaultPrevented) {
      event.preventDefault();
      blocked.push({ method, url: pathAndQuery(form.action || window.location.href), via: "form" });
    }
  };
  document.addEventListener("submit", onSubmit, true);

  if (geolocation) {
    const refuse = (_success: PositionCallback, error?: PositionErrorCallback | null) => {
      error?.({ code: 1, message: "Practice: location is not used.", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      return 0;
    };
    try {
      Object.defineProperty(geolocation, "getCurrentPosition", { configurable: true, value: refuse });
      Object.defineProperty(geolocation, "watchPosition", { configurable: true, value: refuse });
    } catch {
      /* A browser that refuses the override still never gets a request from the practice screens. */
    }
  }

  const uninstall = () => {
    if (active?.uninstall !== uninstall) return;
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
    if (originalBeacon) navigator.sendBeacon = originalBeacon;
    document.removeEventListener("submit", onSubmit, true);
    if (geolocation && originalGetPosition && originalWatch) {
      try {
        // The overrides are own properties shadowing the prototype; removing them restores the browser's.
        const own = geolocation as unknown as Record<string, unknown>;
        delete own.getCurrentPosition;
        delete own.watchPosition;
      } catch {
        /* see above */
      }
    }
    active = null;
  };
  active = { uninstall, blocked };
  return uninstall;
}
