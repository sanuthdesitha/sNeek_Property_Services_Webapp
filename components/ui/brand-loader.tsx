"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * BrandLoader — the branded full-surface loading state.
 *
 * The company logo image (or a clean "sNeek" wordmark fallback) is the hero of
 * the loader. It sits on a tasteful rounded surface so the mark reads on any
 * background (logos shipped on dark backgrounds previously washed out — the
 * surface + ring gives them a dependable backdrop here).
 *
 * On every mount the loader randomly selects ONE of several premium animation
 * variants (see VARIANTS) so the experience feels alive and never repetitive.
 * All variants are pure transform/opacity (GPU-friendly) and live in
 * globals.css; under `prefers-reduced-motion` every variant collapses to a
 * calm opacity breathe (`.brand-loader--reduced`).
 *
 * Logo resolution:
 *   1. If a `logoUrl` prop is provided (portal shells already have it from
 *      getAppSettings), it is used immediately.
 *   2. Otherwise the loader fetches `/api/public/branding`
 *      ({ companyName, logoUrl }) on mount and swaps the logo in when ready.
 *   3. If no logo URL is ever available (or it fails to load), it falls back to
 *      the "sNeek" wordmark rendered in the brand primary token.
 *
 * `surface` controls the palette:
 *   - "portal" (default): standard token theme (bg-background / text-primary).
 *   - "public": inherits the luxury Cormorant-serif marketing scope. Render it
 *     inside an element that carries `.marketing-only` + data-portal-theme so
 *     the serif wordmark and warm ivory tokens apply.
 */

export interface BrandLoaderProps {
  /** Pre-resolved logo URL (portal layouts already have this). */
  logoUrl?: string | null;
  /** Company name, used for the logo alt text and wordmark. */
  companyName?: string | null;
  /** Visual surface — selects palette + typography. */
  surface?: "portal" | "public";
  /** Optional screen-reader / context label (default "Loading"). */
  label?: string;
  /** Fill the parent / viewport (default true). */
  fullscreen?: boolean;
  className?: string;
}

/**
 * The premium animation variants. One is chosen at random per mount. Each value
 * is the modifier class appended to `.brand-loader` and switched on in
 * globals.css. Keep this list in sync with the CSS.
 */
const VARIANTS = [
  "pulse-glow", // breathing glow ring behind the logo
  "orbit", // dots orbiting the mark
  "scan", // sweeping shimmer/scan band over the logo
  "flip", // gentle 3D-ish flip + scale of the mark
  "ripple", // concentric rings rippling outward
] as const;

type Variant = (typeof VARIANTS)[number];

export function BrandLoader({
  logoUrl,
  companyName,
  surface = "portal",
  label = "Loading",
  fullscreen = true,
  className,
}: BrandLoaderProps) {
  const [resolvedLogo, setResolvedLogo] = useState<string | null>(logoUrl ?? null);
  const [name, setName] = useState<string | null>(companyName ?? null);
  const [logoFailed, setLogoFailed] = useState(false);

  // Pick a random variant once, on mount (client-side; Math.random is fine here).
  const variant: Variant = useMemo(
    () => VARIANTS[Math.floor(Math.random() * VARIANTS.length)],
    []
  );

  // Only self-fetch branding when no logo was handed in by a server layout.
  useEffect(() => {
    if (logoUrl) {
      setResolvedLogo(logoUrl);
      return;
    }
    let active = true;
    fetch("/api/public/branding", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (typeof data?.logoUrl === "string" && data.logoUrl) setResolvedLogo(data.logoUrl);
        if (typeof data?.companyName === "string" && data.companyName) setName(data.companyName);
      })
      .catch(() => {
        /* wordmark fallback covers this */
      });
    return () => {
      active = false;
    };
  }, [logoUrl]);

  const showLogo = Boolean(resolvedLogo) && !logoFailed;
  const isPublic = surface === "public";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex items-center justify-center bg-background text-foreground",
        fullscreen ? "min-h-[60vh] w-full" : "",
        className
      )}
    >
      <div
        className={cn(
          "brand-loader text-primary",
          `brand-loader--${variant}`,
          isPublic && "brand-loader--public"
        )}
      >
        {/* Glow halo — used by the pulse-glow / ripple variants. */}
        <span className="brand-loader__glow" aria-hidden="true" />

        {/* Concentric ripple rings (ripple variant). */}
        <span className="brand-loader__ripple" aria-hidden="true" />
        <span className="brand-loader__ripple brand-loader__ripple--2" aria-hidden="true" />
        <span className="brand-loader__ripple brand-loader__ripple--3" aria-hidden="true" />

        {/* Sweeping arc ring. */}
        <svg
          viewBox="0 0 100 100"
          className="brand-loader__ring"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.14"
            strokeWidth="2.5"
          />
          <circle
            className="brand-loader__arc"
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="70 220"
          />
        </svg>

        {/* Orbiting dots (orbit variant). */}
        <span className="brand-loader__orbit" aria-hidden="true">
          <span className="brand-loader__dot" />
          <span className="brand-loader__dot brand-loader__dot--2" />
          <span className="brand-loader__dot brand-loader__dot--3" />
        </span>

        {/* Logo surface — keeps the mark legible on any background. */}
        <div className="brand-loader__mark">
          <div className="brand-loader__plate">
            {showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolvedLogo as string}
                alt={name || "sNeek Property Services"}
                className="brand-loader__logo"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <span
                className={cn(
                  "brand-loader__wordmark",
                  isPublic && "font-display-serif"
                )}
              >
                sNeek
              </span>
            )}
            {/* Scan band (scan variant) — sweeps across the plate. */}
            <span className="brand-loader__scan" aria-hidden="true" />
          </div>
        </div>
      </div>

      <span className="sr-only">{label}…</span>
    </div>
  );
}

export default BrandLoader;
