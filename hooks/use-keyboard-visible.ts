"use client";

import { useEffect, useState } from "react";

/**
 * Returns true when the on-screen keyboard is likely open on a mobile device.
 * Uses `visualViewport` — degrades to always false on browsers without it.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onResize = () => {
      // Heuristic: if visual viewport is < 75% of layout viewport, keyboard is up.
      const ratio = vv.height / window.innerHeight;
      setVisible(ratio < 0.75);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  return visible;
}
