"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * BrandLoader — the branded full-surface loading state.
 *
 * A centred company logo (or a clean "sNeek" monogram fallback) sits inside a
 * slowly rotating ring drawn in the brand primary colour. The mark gently
 * pulses. Both animations come from globals.css (`.brand-loader-ring`,
 * `.brand-loader-mark`) and automatically collapse to a calm fade under
 * `prefers-reduced-motion` — no spin, just a gentle opacity breathe.
 *
 * Logo resolution:
 *   1. If a `logoUrl` prop is provided (portal shells already have it from
 *      getAppSettings), it is used immediately.
 *   2. Otherwise the loader fetches `/api/public/branding`
 *      ({ companyName, logoUrl }) on mount and swaps the logo in when ready.
 *   3. If no logo URL is ever available, it falls back to the "sNeek" wordmark
 *      monogram rendered in the brand primary token.
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
        /* monogram fallback covers this */
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
      <div className="relative flex h-32 w-32 items-center justify-center">
        {/* Rotating brand ring */}
        <svg
          viewBox="0 0 100 100"
          className="brand-loader-ring absolute inset-0 h-full w-full text-primary"
          aria-hidden="true"
        >
          {/* faint full track */}
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.14"
            strokeWidth="3"
          />
          {/* bright sweeping arc */}
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="70 210"
          />
        </svg>

        {/* Centred mark */}
        <div className="brand-loader-mark flex h-20 w-20 items-center justify-center">
          {showLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolvedLogo as string}
              alt={name || "sNeek Property Services"}
              className="max-h-16 max-w-16 object-contain"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <span
              className={cn(
                "select-none text-3xl font-semibold tracking-tight text-primary",
                isPublic && "font-display-serif"
              )}
            >
              sNeek
            </span>
          )}
        </div>
      </div>

      <span className="sr-only">{label}…</span>
    </div>
  );
}

export default BrandLoader;
