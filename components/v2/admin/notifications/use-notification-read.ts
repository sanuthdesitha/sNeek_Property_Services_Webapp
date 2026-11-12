"use client";

import * as React from "react";

/**
 * One cancellable JSON read for the notifications area. An obsolete request is
 * aborted, and a late response is dropped after parsing (so a response for an
 * old filter never fills the current view). Keeps the last good data on a
 * failed refresh: `error` with `data` is the stale state. Data belongs to the
 * URL it was read from: when the URL changes (another type, filter or page)
 * the previous result is no longer shown as if it answered the new request.
 */
export type ReadState<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };

export function useNotificationRead<T>(url: string | null, parse: (body: unknown) => T, failure: string): ReadState<T> {
  const [result, setResult] = React.useState<{ url: string; data: T } | null>(null);
  const [loading, setLoading] = React.useState(Boolean(url));
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const parseRef = React.useRef(parse);
  parseRef.current = parse;

  React.useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (!current) return;
        if (!response.ok) {
          const message = body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string" ? (body as { error: string }).error : failure;
          setError(message);
          return;
        }
        const parsed = parseRef.current(body);
        if (!current) return;
        setResult({ url, data: parsed });
      } catch {
        if (current && !controller.signal.aborted) setError(failure);
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [url, failure, tick]);

  const reload = React.useCallback(() => setTick((value) => value + 1), []);
  const data = result && result.url === url ? result.data : null;
  return { data, loading, error, reload };
}

export type SendResult = { ok: true; body: unknown } | { ok: false; error: string; status: number; body: unknown };

export async function sendJson(url: string, method: "POST" | "PATCH" | "PUT", body: unknown): Promise<SendResult> {
  try {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error: unknown }).error === "string" ? (parsed as { error: string }).error : "The change could not be saved.";
      return { ok: false, error, status: response.status, body: parsed };
    }
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, error: "The server could not be reached. Nothing was changed.", status: 0, body: null };
  }
}
