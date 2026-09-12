"use client";
import { useEffect, useRef } from "react";
import { JOBS_SCROLL_STORAGE_KEY, readJobsScrollPositions, type JobsScrollPosition } from "@/lib/jobs/scroll-restoration";

export function useJobsScrollRestoration({ context, viewKey, contentKey, ready }: {
  context?: string; viewKey: string; contentKey: string; ready: boolean;
}) {
  const scope = context ? JSON.stringify([context, viewKey]) : null;
  const cancelledScope = useRef<string | null>(null);
  // Cancel delayed restoration if the operator starts interacting while data loads.
  useEffect(() => {
    if (!scope) return;
    const cancel = () => { cancelledScope.current = scope; };
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(event, cancel, { passive: true });
    return () => { for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(event, cancel); };
  }, [scope]);

  useEffect(() => {
    if (!scope || !ready) return;
    let active = true;
    let listening = false;
    let lastPosition: JobsScrollPosition | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    let settling = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | undefined;
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const store = () => {
      if (!lastPosition) return;
      try {
        const positions = readJobsScrollPositions(window.sessionStorage.getItem(JOBS_SCROLL_STORAGE_KEY));
        window.sessionStorage.setItem(JOBS_SCROLL_STORAGE_KEY, JSON.stringify([lastPosition, ...positions.filter(row => row.scope !== scope)].slice(0, 20)));
      } catch { /* Navigation works when browser storage is unavailable. */ }
    };
    const capture = () => {
      if (settling && cancelledScope.current !== scope) return;
      lastPosition = { scope, content: contentKey, x: Math.max(0, window.scrollX), y: Math.max(0, window.scrollY), width: window.innerWidth, height: window.innerHeight, savedAt: Date.now() };
      store();
    };
    let saved: JobsScrollPosition | undefined;
    try { saved = readJobsScrollPositions(window.sessionStorage.getItem(JOBS_SCROLL_STORAGE_KEY)).find(row => row.scope === scope); } catch { /* optional storage */ }
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (!active) return;
        const restore = () => {
          if (!active || !saved || cancelledScope.current === scope) return;
          const root = document.documentElement;
          const maxY = Math.max(0, root.scrollHeight - window.innerHeight);
          const maxX = Math.max(0, root.scrollWidth - window.innerWidth);
          // Stale or shorter results cannot support an exact restoration.
          if (saved.y <= maxY && saved.x <= maxX) window.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
        };
        if (saved && saved.content === contentKey && saved.width === window.innerWidth && saved.height === window.innerHeight && cancelledScope.current !== scope) {
          restore();
          // Preferences/fonts can change the height after Jobs rows render. Keep
          // the requested position through that short layout-settling window.
          settling = true;
          lastPosition = saved;
          if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(() => { if (settling) restore(); });
            observer.observe(document.body);
          }
          settleTimer = setTimeout(() => { settling = false; observer?.disconnect(); capture(); }, 2000);
        }
        // Do not overwrite a saved position just because a loading skeleton clamped it.
        capture();
        window.addEventListener("scroll", capture, { passive: true });
        window.addEventListener("pagehide", store);
        listening = true;
      });
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(firstFrame); window.cancelAnimationFrame(secondFrame);
      if (settleTimer) clearTimeout(settleTimer);
      observer?.disconnect();
      if (listening) {
        window.removeEventListener("scroll", capture);
        window.removeEventListener("pagehide", store);
        // Use the last observed position, not the next screen's newly laid-out scroll.
        store();
      }
      window.history.scrollRestoration = previousRestoration;
    };
  }, [scope, ready, contentKey]);
}
