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
/** Set the moment a file input's picker returns with a file — see below. */
const PICK_KEY = "__sneek_upload_pick__";
const REPORT_URL = "/api/debug/upload-watchdog";
/** Ignore stale breadcrumbs — only a recent upload is evidence of anything. */
const BREADCRUMB_MAX_AGE_MS = 5 * 60_000;
/**
 * How long after a file pick a teardown is still blamed on the pick. The
 * owner's symptom is "I press OK and the page refreshes" — seconds, not
 * minutes — but decode + stamping of a huge photo can take a while on a slow
 * phone, so the window is generous.
 */
const PICK_WINDOW_MS = 30_000;

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
/** When a file input last produced a file (the picker's OK), 0 = never. */
let lastPickAt = 0;

/** True while we are inside the window where a teardown is pick-related. */
function withinPickWindow() {
  return lastPickAt > 0 && Date.now() - lastPickAt <= PICK_WINDOW_MS;
}

/**
 * Called by providers.tsx when the hard-sync path bumps `hardRefreshKey`.
 *
 * That bump REMOUNTS the entire app tree. To a person mid-upload it is
 * indistinguishable from a page refresh — the form resets, the photo vanishes —
 * yet the document never navigates, so pagehide, beforeunload and the
 * navigation-type breadcrumb all stay silent. This is the one teardown shape
 * the document-level detectors are structurally blind to, so the trigger
 * reports itself.
 */
export function reportUploadWatchdogRemount() {
  if (inFlight === 0 && !withinPickWindow()) return;
  report({
    reason: "app-remount-during-upload",
    uploadAgeMs: inFlight > 0 ? Date.now() - startedAt : undefined,
    extra: {
      inFlight,
      msSincePick: lastPickAt ? Date.now() - lastPickAt : -1,
    },
  });
}

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

    // --- Detector 2, run first: did the PREVIOUS page die mid-upload,
    // or right after a file pick that never became an upload? ---
    try {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;

      const crumb = sessionStorage.getItem(BREADCRUMB_KEY);
      if (crumb) {
        sessionStorage.removeItem(BREADCRUMB_KEY);
        const age = Date.now() - Number(crumb);
        if (Number.isFinite(age) && age >= 0 && age < BREADCRUMB_MAX_AGE_MS) {
          report({
            reason: "page-restarted-during-upload",
            navType: nav?.type ?? "unknown",
            uploadAgeMs: age,
          });
        }
      }

      // The owner's symptom is that the refresh happens as the picker closes —
      // often BEFORE any POST begins (decode/stamping runs first, and a huge
      // photo can OOM the tab right there). The upload crumb never gets set in
      // that case, so the pick itself leaves one.
      const pick = sessionStorage.getItem(PICK_KEY);
      if (pick) {
        sessionStorage.removeItem(PICK_KEY);
        const age = Date.now() - Number(pick);
        if (Number.isFinite(age) && age >= 0 && age < BREADCRUMB_MAX_AGE_MS && !crumb) {
          report({
            reason: "page-restarted-after-file-pick",
            navType: nav?.type ?? "unknown",
            uploadAgeMs: age,
          });
        }
      }
    } catch {
      /* ignore */
    }

    // --- The pick itself: a file input produced a file. Capture phase on
    // `change` so it fires for every picker in the app, whether the input is
    // visible, hidden behind a label, or clicked programmatically. ---
    const onFilePicked = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.type !== "file" || !target.files || target.files.length === 0) return;
      lastPickAt = Date.now();
      try {
        sessionStorage.setItem(PICK_KEY, String(lastPickAt));
      } catch {
        /* private mode — the live detectors still work */
      }
    };
    document.addEventListener("change", onFilePicked, true);

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
          } else {
            // The pick made it all the way through — nothing left to blame on it.
            lastPickAt = 0;
            try {
              sessionStorage.removeItem(PICK_KEY);
            } catch {
              /* ignore */
            }
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

    // --- Detector 1: the page is going away. Armed while a POST is in flight
    // OR shortly after a file pick — the second case is the owner's actual
    // symptom, where the page dies during decode/stamping before any request
    // exists. (A tab merely hiding for the picker does NOT fire pagehide, so
    // the pick window cannot false-positive on opening the next picker.) ---
    const teardownReason = (base: string) => {
      if (inFlight > 0) return `${base}-during-upload`;
      return `${base}-after-file-pick`;
    };
    const onPageHide = (event: PageTransitionEvent) => {
      if (inFlight === 0 && !withinPickWindow()) return;
      report({
        reason: event.persisted ? "bfcached-during-upload" : teardownReason("pagehide"),
        uploadAgeMs: inFlight > 0 ? Date.now() - startedAt : Date.now() - lastPickAt,
      });
    };
    const onBeforeUnload = () => {
      if (inFlight === 0 && !withinPickWindow()) return;
      report({
        reason: teardownReason("beforeunload"),
        uploadAgeMs: inFlight > 0 ? Date.now() - startedAt : Date.now() - lastPickAt,
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
