"use client";

import { useEffect, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { orderedRoute, type AccessGuideEntry } from "@/lib/properties/access-guide";

/**
 * ACCESS-1 — the guided route: where to go, in order.
 *
 * THE LIST IS THE FEATURE. The brief asks for an animated route *and* that it
 * "read as a numbered list too", so the list is rendered unconditionally and
 * the animation is decoration on top of it. That ordering matters: it is what
 * makes this work with no Maps API key, with motion disabled, on a bad phone
 * signal in a basement carpark — which is exactly where somebody is standing
 * when they need it.
 *
 * Motion: a step highlights in turn, but only when the viewer has not asked for
 * reduced motion. `prefers-reduced-motion` is honoured by not running the timer
 * at all rather than by shortening it — a reduced-motion user gets a static,
 * fully-readable list, not a faster flicker.
 *
 * Maps: each pinned step links out to Google Maps. That is the documented
 * no-API-key fallback (see lib/maps/loader.ts) and it is used here as the
 * PRIMARY affordance, so this component never depends on the SDK loading.
 */

const STEP_MS = 2200;

export function AccessRoute({
  entries,
  className,
}: {
  entries: readonly AccessGuideEntry[];
  className?: string;
}) {
  const steps = orderedRoute(entries);
  const [activeIndex, setActiveIndex] = useState(0);
  const [animate, setAnimate] = useState(false);

  // Decide once whether motion is welcome, and keep listening — a viewer can
  // change the OS setting while the page is open.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setAnimate(!query.matches);
    apply();
    query.addEventListener?.("change", apply);
    return () => query.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    if (!animate || steps.length < 2) return;
    const timer = window.setInterval(
      () => setActiveIndex((i) => (i + 1) % steps.length),
      STEP_MS
    );
    return () => window.clearInterval(timer);
  }, [animate, steps.length]);

  if (steps.length === 0) return null;

  return (
    <section className={className} aria-label="Route to follow">
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const isActive = animate && index === activeIndex;
          return (
            <li
              key={step.id}
              className={
                "flex gap-3 rounded-[var(--e-radius)] border p-3 transition-colors duration-500 " +
                (isActive
                  ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.06)]"
                  : "border-[hsl(var(--e-border))]")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-[650] transition-colors duration-500 " +
                  (isActive
                    ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                    : "bg-[hsl(var(--e-surface-2))] text-[hsl(var(--e-muted-foreground))]")
                }
              >
                {index + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-[0.875rem] font-[600]">{step.label}</p>
                {step.level || step.locationNote ? (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {step.level ? <span className="font-[550]">{step.level}</span> : null}
                    {step.level && step.locationNote ? " · " : null}
                    {step.locationNote}
                  </p>
                ) : null}
                {step.instructions ? (
                  <p className="whitespace-pre-wrap text-[0.8125rem] leading-6 text-[hsl(var(--e-text-secondary))]">
                    {step.instructions}
                  </p>
                ) : null}
                {step.lat != null && step.lng != null ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${step.lat},${step.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-primary))] underline underline-offset-2"
                  >
                    <MapPin className="h-3 w-3" /> Open in Maps
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default AccessRoute;
