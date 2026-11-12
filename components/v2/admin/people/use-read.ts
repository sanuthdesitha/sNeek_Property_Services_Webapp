"use client";

/**
 * Reads one JSON resource for a People screen. A newer read aborts the older
 * one and every answer is checked against the request still current after
 * parsing, so a slow response never fills a different list or entity. On
 * failure the last good answer stays (stale) beside the error, except when
 * the URL names a different entity (`resetOnChange`).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type ReadState<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };

export function useRead<T>(url: string | null, isValid: (body: unknown) => body is T, options: { resetOnChange?: boolean; failure?: string } = {}): ReadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const current = useRef("");
  const { resetOnChange = false, failure = "Could not load." } = options;

  useEffect(() => {
    if (resetOnChange) setData(null);
  }, [url, resetOnChange]);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const key = `${url}#${revision}`;
    current.current = key;
    setLoading(true);
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted || current.current !== key) return;
        if (!response.ok || !isValid(body)) {
          const message = body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string" ? (body as { error: string }).error : `${failure} (${response.status})`;
          throw new Error(message);
        }
        setData(body);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current.current !== key) return;
        setError(reason instanceof Error ? reason.message : failure);
      })
      .finally(() => {
        if (!controller.signal.aborted && current.current === key) setLoading(false);
      });
    return () => controller.abort();
    // isValid is a stable type guard defined at module level by callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, revision, failure]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loading, error, reload };
}
