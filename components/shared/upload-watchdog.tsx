"use client";

import { useEffect } from "react";

/**
 * TEMPORARY. Finds out what destroys the page while a photo is uploading.
 *
 * The report is "I pick a photo, press OK, the page refreshes, nothing
 * uploads", and the server sees `abortIncoming` / ECONNRESET — a body that
 * started arriving and then stopped. Four rounds of reading code failed to
 * identify the cause, so this observes it directly instead of inferring.
 *
 * Two independent detectors, because the interesting case is precisely the one
 * where the page dies and ordinary logging dies with it:
 *
 *  1. `pagehide` — fires even when the page is discarded or bfcached. If an
 *     upload is in flight we beacon immediately. `sendBeacon` is used because
 *     it is the only request guaranteed to outlive the document.
 *  2. A sessionStorage breadcrumb — survives a reload. On the NEXT load we
 *     check whether the previous page died mid-upload, and what kind of
 *     navigation brought us here (`reload` being the smoking gun). This catches
 *     the case where even the beacon does not make it out.
 *
 * `location.reload` is wrapped so that if anything calls it we capture the
 * stack, which names the culprit outright rather than leaving us to guess.
 *
 * Delete once the bug is closed.
 */

const UPLOAD_URL_FRAGMENT = "/api/uploads/direct";
const BREADCRUMB_KEY = "__sneek_upload_watchdog__";
const REPORT_URL = "/api/debug/upload-watchdog";
/** Ignore stale breadcrumbs — only a recent upload is evidence of anything. */
const BREADCRUMB_MAX_AGE_MS = 5 * 60_000;

type Report = {
  reason: string;
  navType?: string;
  uploadAgeMs?: number;
  reloadStack?: string;
  path?: string;
  ua?: string;
};

function report(payload: Report) {
  try {
    const body = JSON.stringify({
      ...payload,
      path: payload.path ?? location.pathname,
      ua: payload.ua ?? navigator.userAgent.slice(0, 300),
    });
    // Beacon first: the only transport that reliably survives teardown.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(REPORT_URL, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(REPORT_URL, { method: "POST", body, keepalive: true });
  } catch {
    // Never let the diagnostic break the page it is diagnosing.
  }
}

export function UploadWatchdog() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let inFlight = 0;
    let startedAt = 0;
    let reloadStack: string | undefined;

    const markStart = () => {
      inFlight += 1;
      if (inFlight === 1) startedAt = Date.now();
      try {
        sessionStorage.setItem(BREADCRUMB_KEY, String(Date.now()));
      } catch {
        /* private mode — the pagehide detector still works */
      }
    };
    const markEnd = () => {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0) {
        try {
          sessionStorage.removeItem(BREADCRUMB_KEY);
        } catch {
          /* ignore */
        }
      }
    };

    // --- Detector 2, run first: did the PREVIOUS page die mid-upload? ---
    try {
      const crumb = sessionStorage.getItem(BREADCRUMB_KEY);
      if (crumb) {
        sessionStorage.removeItem(BREADCRUMB_KEY);
        const age = Date.now() - Number(crumb);
        if (Number.isFinite(age) && age >= 0 && age < BREADCRUMB_MAX_AGE_MS) {
          const nav = performance.getEntriesByType("navigation")[0] as
            | PerformanceNavigationTiming
            | undefined;
          report({
            reason: "page-restarted-during-upload",
            navType: nav?.type ?? "unknown",
            uploadAgeMs: age,
          });
        }
      }
    } catch {
      /* ignore */
    }

    // --- Watch uploads by wrapping fetch ---
    const originalFetch = window.fetch;
    window.fetch = function patchedFetch(this: unknown, ...args: Parameters<typeof fetch>) {
      const input = args[0];
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request)?.url ?? "";
      if (!url.includes(UPLOAD_URL_FRAGMENT)) {
        return originalFetch.apply(this as never, args);
      }

      markStart();
      return originalFetch
        .apply(this as never, args)
        .then((res) => {
          markEnd();
          return res;
        })
        .catch((err) => {
          markEnd();
          throw err;
        });
    } as typeof window.fetch;

    // --- Name anything that calls reload ---
    const originalReload = window.location.reload.bind(window.location);
    try {
      Object.defineProperty(window.location, "reload", {
        configurable: true,
        value: function patchedReload() {
          reloadStack = new Error("reload called").stack?.slice(0, 2000);
          if (inFlight > 0) {
            report({
              reason: "reload-during-upload",
              uploadAgeMs: Date.now() - startedAt,
              reloadStack,
            });
          }
          return originalReload();
        },
      });
    } catch {
      // Some browsers refuse to redefine location.reload; the other detectors
      // still work, we just lose the stack.
    }

    // --- Detector 1: the page is going away ---
    const onPageHide = (event: PageTransitionEvent) => {
      if (inFlight === 0) return;
      report({
        reason: event.persisted ? "bfcached-during-upload" : "pagehide-during-upload",
        uploadAgeMs: Date.now() - startedAt,
        reloadStack,
      });
    };
    const onBeforeUnload = () => {
      if (inFlight === 0) return;
      report({
        reason: "beforeunload-during-upload",
        uploadAgeMs: Date.now() - startedAt,
        reloadStack,
      });
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.fetch = originalFetch;
      try {
        Object.defineProperty(window.location, "reload", {
          configurable: true,
          value: originalReload,
        });
      } catch {
        /* ignore */
      }
    };
  }, []);

  return null;
}
