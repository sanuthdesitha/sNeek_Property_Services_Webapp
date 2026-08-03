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
  path?: string;
  ua?: string;
  extra?: Record<string, string | number | boolean>;
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

/**
 * Installed once per document, never uninstalled.
 *
 * The first version restored `window.fetch` and `location.reload` on unmount,
 * which was wrong twice over. `GlobalRequestProgress` also wraps `window.fetch`,
 * and two wrappers that each restore "the original" on cleanup clobber one
 * another; and React runs effects mount -> cleanup -> mount in development, so
 * the restore raced the install. Verified live on the dev server: `window.fetch`
 * carried only GlobalRequestProgress's wrapper and `location.reload` was still
 * native — i.e. the diagnostic was silently not watching anything.
 *
 * Module scope rather than a ref because the point is one installation per
 * document, surviving every remount, for as long as the page lives. A
 * diagnostic that can uninstall itself reports nothing and looks like proof
 * that nothing happened.
 */
let installed = false;
let inFlight = 0;
let startedAt = 0;

export function UploadWatchdog() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (installed) return;
    installed = true;

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
      const requestStartedAt = Date.now();
      return originalFetch
        .apply(this as never, args)
        .then((res) => {
          markEnd();
          // The server logs `abortIncoming` / ECONNRESET for TWO different
          // causes and they need opposite fixes: the browser destroying the
          // page mid-POST (the detectors above), or something between the
          // browser and the app cutting the connection — a reverse-proxy body
          // limit being the classic one, since nginx's default
          // `client_max_body_size` is 1MB and every phone photo is larger.
          // In the second case the page survives, so nothing above fires and
          // we would learn nothing. Report the response itself.
          if (!res.ok) {
            report({
              reason: "upload-http-error",
              uploadAgeMs: Date.now() - requestStartedAt,
              extra: { status: res.status, statusText: String(res.statusText).slice(0, 100) },
            });
          }
          return res;
        })
        .catch((err: unknown) => {
          markEnd();
          // A rejected fetch on a live page means the REQUEST died while the
          // document lived — i.e. not a teardown. The message distinguishes a
          // connection reset from an ordinary offline blip.
          report({
            reason: "upload-fetch-failed",
            uploadAgeMs: Date.now() - requestStartedAt,
            extra: { message: String((err as Error)?.message ?? err).slice(0, 200) },
          });
          throw err;
        });
    } as typeof window.fetch;

    // There is deliberately NO `location.reload` wrapper here.
    //
    // The first version wrapped it to capture the caller's stack, which would
    // have named the culprit outright. It cannot work: `reload` is an
    // unforgeable property of `Location`, so it is non-configurable and
    // `Object.defineProperty` throws `Cannot redefine property: reload` — which
    // a `try/catch` then swallowed, leaving a detector that looked installed
    // and reported nothing. Verified in the browser rather than assumed.
    //
    // The breadcrumb detector above already establishes the fact that matters —
    // `navType === "reload"` says the document was reloaded mid-upload — so
    // nothing is lost except the stack, which was never obtainable.

    // --- Detector 1: the page is going away ---
    const onPageHide = (event: PageTransitionEvent) => {
      if (inFlight === 0) return;
      report({
        reason: event.persisted ? "bfcached-during-upload" : "pagehide-during-upload",
        uploadAgeMs: Date.now() - startedAt,
      });
    };
    const onBeforeUnload = () => {
      if (inFlight === 0) return;
      report({
        reason: "beforeunload-during-upload",
        uploadAgeMs: Date.now() - startedAt,
      });
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    // No cleanup on purpose. Everything installed above lives for the life of
    // the document: the listeners must still be there when the page is being
    // destroyed (that IS the event we are trying to catch), and unwrapping
    // fetch/reload on unmount is what broke the first version.
  }, []);

  return null;
}
