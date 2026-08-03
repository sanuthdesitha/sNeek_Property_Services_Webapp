"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

const SOFT_SYNC_MIN_AWAY_MS = 45_000;
const MIN_SYNC_GAP_MS = 12_000;
/**
 * How long after clicking a file input the tab may hide and still count as
 * "the picker opened" rather than "the user left". Generous enough for a slow
 * device to raise the dialog, short enough that an unrelated tab switch a
 * minute later is still treated as a real absence.
 */
const FILE_DIALOG_HIDE_WINDOW_MS = 3_000;

type SyncMode = "soft" | "hard";

export function ReturnSync({ onHardSync }: { onHardSync: () => void }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const queryClient = useQueryClient();
  const hiddenAtRef = useRef<number | null>(null);
  const lastSyncAtRef = useRef(0);
  /** When a file input was last clicked — see the file-dialog note below. */
  const fileDialogAtRef = useRef(0);

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

    /**
     * A file dialog is not "the user went away".
     *
     * Opening a file picker or the camera hides the tab, so someone who spent
     * longer than SOFT_SYNC_MIN_AWAY_MS choosing a photo — which browsing
     * folders on a laptop passes easily — came back to a `router.refresh()`
     * fired at the exact moment their upload was starting. To them the page
     * simply reloaded and the photo never arrived: on every device, in
     * incognito, on every upload surface in the app, because this provider
     * wraps all of them.
     *
     * Detecting it here rather than in each capture component is deliberate.
     * There are dozens of file inputs across the portals, and any one that
     * forgot to opt out would silently bring the bug back.
     */
    function onFileInputClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement && target.type === "file" && !target.disabled) {
        fileDialogAtRef.current = Date.now();
      }
    }

    /** True when the hidden period was a file dialog rather than an absence. */
    function wasFileDialog(hiddenAt: number) {
      const openedAt = fileDialogAtRef.current;
      if (!openedAt) return false;
      // The dialog click lands immediately before the tab hides. Anything
      // outside that window is a genuine tab switch that merely happens to
      // follow an earlier upload, and should still sync.
      return hiddenAt - openedAt <= FILE_DIALOG_HIDE_WINDOW_MS;
    }

    function handleReturn() {
      const hiddenAt = hiddenAtRef.current;
      if (!hiddenAt) return;
      const awayMs = Date.now() - hiddenAt;
      hiddenAtRef.current = null;

      if (wasFileDialog(hiddenAt)) {
        // Consume it, so a later real absence is not excused by the same click.
        fileDialogAtRef.current = 0;
        return;
      }
      if (awayMs >= SOFT_SYNC_MIN_AWAY_MS) {
        runSync("soft");
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      handleReturn();
    }

    function onFocus() {
      handleReturn();
    }

    function onPageShow(event: PageTransitionEvent) {
      // Browser back/forward cache restore can preserve stale UI state.
      if (event.persisted) {
        runSync("hard", true);
      }
    }

    // Capture phase: a click on a <label> wrapping a hidden input reaches the
    // input as a synthetic click, and capture sees it whatever the page does
    // with the event afterwards.
    document.addEventListener("click", onFileInputClick, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("click", onFileInputClick, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [isAuthRoute, runSync]);

  return null;
}

