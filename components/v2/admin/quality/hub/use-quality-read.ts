"use client";

/**
 * One cancellable read per URL. The previous read is aborted when the URL
 * changes, cancellation is checked again after the body is parsed, and data
 * remembers the URL that produced it, so rows from another period, filter or
 * cleaner are never shown as if they answered the current one.
 *
 * - loading, no data          → loading state
 * - error, no data            → failure state
 * - data and error (same url) → stale: the last good data with a warning
 */
import * as React from "react";

export type QualityRead<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

function errorFrom(body: unknown, fallback: string): string {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  return typeof error === "string" && error ? error : fallback;
}

export function useQualityRead<T>(
  url: string | null,
  isValid: (body: unknown) => body is T,
  failureMessage: string,
): QualityRead<T> {
  const [loaded, setLoaded] = React.useState<{ url: string; data: T } | null>(null);
  const [failed, setFailed] = React.useState<{ url: string; message: string } | null>(null);
  const [loading, setLoading] = React.useState(Boolean(url));
  const [token, setToken] = React.useState(0);
  const validRef = React.useRef(isValid);
  validRef.current = isValid;

  React.useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !validRef.current(body)) {
          setFailed({ url, message: errorFrom(body, failureMessage) });
          return;
        }
        setLoaded({ url, data: body });
        setFailed(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setFailed({ url, message: cause instanceof Error && cause.message ? cause.message : failureMessage });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [url, token, failureMessage]);

  const reload = React.useCallback(() => setToken((value) => value + 1), []);
  return {
    data: url && loaded?.url === url ? loaded.data : null,
    loading,
    error: url && failed?.url === url ? failed.message : null,
    reload,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasArray(value: unknown, key: string): boolean {
  return isRecord(value) && Array.isArray(value[key]);
}

/** Re-read (keeping the current rows on screen) whenever `token` changes after mount. */
export function useReloadOn(token: number, reload: () => void) {
  const seen = React.useRef(token);
  React.useEffect(() => {
    if (seen.current === token) return;
    seen.current = token;
    reload();
  }, [token, reload]);
}
