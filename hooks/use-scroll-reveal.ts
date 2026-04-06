"use client";

import { useEffect, useRef } from "react";

/**
 * Attaches an IntersectionObserver to the container element and adds
 * "is-visible" to any child with a "scroll-reveal*" class when it enters
 * the viewport. Safe to call at the layout / page level.
 *
 * Usage:
 *   const ref = useScrollReveal();
 *   <section ref={ref}> ... elements with className="scroll-reveal" ... </section>
 */
export function useScrollReveal(threshold = 0.12) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const targets = root.querySelectorAll<HTMLElement>(
      ".scroll-reveal, .scroll-reveal-left, .scroll-reveal-right, .scroll-reveal-scale"
    );

    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold }
    );

    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [threshold]);

  return ref;
}
