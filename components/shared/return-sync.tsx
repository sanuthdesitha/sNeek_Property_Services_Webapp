"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

const SOFT_SYNC_MIN_AWAY_MS = 45_000;
const MIN_SYNC_GAP_MS = 12_000;

type SyncMode = "soft" | "hard";

export function ReturnSync({ onHardSync }: { onHardSync: () => void }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const queryClient = useQueryClient();
  const hiddenAtRef = useRef<number | null>(null);
  const lastSyncAtRef = useRef(0);

  const isAuthRoute = pathname === "/login" || pathname === "/register";

  const runSync = useCallback(
    (mode: SyncMode, force = false) => {
      if (isAuthRoute) return;
      const now = Date.now();
      if (!force && now - lastSyncAtRef.current < MIN_SYNC_GAP_MS) return;
      lastSyncAtRef.current = now;

      queryClient.invalidateQueries();
      router.refresh();
      window.dispatchEvent(
        new CustomEvent("app:data-refresh", {
          detail: { mode, at: now, pathname },
        })
      );

      if (mode === "hard") {
        onHardSync();
      }
    },
    [isAuthRoute, onHardSync, pathname, queryClient, router]
  );

  useEffect(() => {
    if (isAuthRoute) return;

    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      if (!hiddenAt) return;
      const awayMs = Date.now() - hiddenAt;
      hiddenAtRef.current = null;
      if (awayMs >= SOFT_SYNC_MIN_AWAY_MS) {
        runSync("soft");
      }
    }

    function onFocus() {
      const hiddenAt = hiddenAtRef.current;
      if (!hiddenAt) return;
      const awayMs = Date.now() - hiddenAt;
      hiddenAtRef.current = null;
      if (awayMs >= SOFT_SYNC_MIN_AWAY_MS) {
        runSync("soft");
      }
    }

    function onPageShow(event: PageTransitionEvent) {
      // Browser back/forward cache restore can preserve stale UI state.
      if (event.persisted) {
        runSync("hard", true);
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [isAuthRoute, runSync]);

  return null;
}

