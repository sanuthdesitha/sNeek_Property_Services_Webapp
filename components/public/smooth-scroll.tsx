"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * SmoothScroll — Aman-style slow, eased momentum scrolling for the PUBLIC
 * marketing site only. Mounted from the public layout so it never affects the
 * webapp/portal routes.
 *
 * - Honours prefers-reduced-motion: when the user prefers reduced motion we do
 *   NOT instantiate Lenis at all, so native (instant) scrolling is preserved.
 * - Cleans up the rAF loop + Lenis instance on unmount (route leave).
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced) return;

    const lenis = new Lenis({
      // Slow, elegant feel — long duration with a gentle ease-out.
      duration: 1.4,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 0.9,
      touchMultiplier: 1.4,
    });

    // Expose the instance for components that want to read scroll velocity.
    (window as unknown as { __lenis?: Lenis }).__lenis = lenis;

    let frame = 0;
    function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    }
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
      delete (window as unknown as { __lenis?: Lenis }).__lenis;
    };
  }, []);

  return <>{children}</>;
}
