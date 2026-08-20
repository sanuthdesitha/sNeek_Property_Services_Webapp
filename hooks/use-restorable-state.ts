"use client";

/**
 * useState that remembers, so the back button rewinds instead of resetting.
 *
 * Drop-in for a page's filter/tab/search state. On mount it reads whatever the
 * page last held; on every change it writes it back. Leaving a list, opening a
 * row and pressing back now returns the list as it was, rather than as it ships.
 *
 * Deliberately restores on EVERY mount, not only on a back navigation. "Where
 * was I" has the same answer whether the person pressed back or clicked Jobs in
 * the nav, and detecting the difference means fighting the App Router for
 * ownership of history state — fragile, and invisible when it breaks.
 *
 * See lib/client/restorable-state.ts for why sessionStorage and why the key
 * includes the pathname.
 */

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  clearRestorablePath,
  mergeRestorable,
  readRestorable,
  writeRestorable,
} from "@/lib/client/restorable-state";

export function useRestorableState<T>(
  key: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const pathname = usePathname() ?? "";

  // The first render must match the server's, or React logs a hydration
  // mismatch and discards the restored value anyway. So the stored value is
  // applied in an effect, one paint later.
  const [value, setValue] = React.useState<T>(initial);
  const restored = React.useRef(false);

  React.useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const stored = readRestorable<unknown>(pathname, key);
    if (stored !== undefined) setValue((current) => mergeRestorable(current, stored));
  }, [pathname, key]);

  React.useEffect(() => {
    // Nothing is written before the restore runs, or the initial value would
    // overwrite what we are about to read.
    if (!restored.current) return;
    writeRestorable(pathname, key, value);
  }, [pathname, key, value]);

  const reset = React.useCallback(() => {
    setValue(initial);
    clearRestorablePath(pathname);
    // The restored flag stays set, so the write effect persists this reset
    // rather than letting the old value come back on the next visit.
  }, [initial, pathname]);

  return [value, setValue, reset];
}

/**
 * Put the scroll position back when a list is returned to.
 *
 * Only worth it for long lists: a page that fits on screen gains nothing, and a
 * mis-restored scroll is more jarring than none. Restores once, after the list
 * has had a chance to render — restoring against an empty list would scroll to
 * the top and look like it did nothing.
 */
export function useRestorableScroll(key: string, ready: boolean): void {
  const pathname = usePathname() ?? "";
  const restored = React.useRef(false);

  React.useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const stored = readRestorable<number>(pathname, `${key}:scroll`);
    if (typeof stored === "number" && stored > 0) {
      // rAF so the browser has laid the list out; a synchronous scroll here
      // lands on a page still the height of its skeleton.
      requestAnimationFrame(() => window.scrollTo({ top: stored }));
    }
  }, [pathname, key, ready]);

  React.useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      // Coalesced to one write per frame: serialising to sessionStorage on
      // every scroll event is work on a hot path.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        writeRestorable(pathname, `${key}:scroll`, window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname, key]);
}
