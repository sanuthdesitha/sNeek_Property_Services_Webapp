"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Sphere-UI chart palette resolved from the live CSS design tokens so charts
 * always match the active brand theme (light/dark/portal). Recharts renders
 * SVG with literal color attributes — CSS var() does not resolve inside SVG
 * presentation attributes — so we read the computed token values off a mounted
 * element and hand Recharts concrete `hsl(...)` strings.
 */
export interface ChartColors {
  primary: string;
  accent: string;
  success: string;
  warning: string;
  info: string;
  destructive: string;
  muted: string;
  mutedForeground: string;
  border: string;
  foreground: string;
  surface: string;
  /** Ordered series palette for multi-series charts. */
  series: string[];
}

const SSR_DEFAULTS: ChartColors = {
  primary: "hsl(188 78% 30%)",
  accent: "hsl(35 95% 50%)",
  success: "hsl(152 62% 38%)",
  warning: "hsl(38 95% 50%)",
  info: "hsl(212 80% 50%)",
  destructive: "hsl(0 72% 52%)",
  muted: "hsl(240 7% 95%)",
  mutedForeground: "hsl(240 4% 44%)",
  border: "hsl(240 6% 90%)",
  foreground: "hsl(240 6% 10%)",
  surface: "hsl(0 0% 100%)",
  series: [
    "hsl(188 78% 38%)",
    "hsl(35 95% 52%)",
    "hsl(212 80% 56%)",
    "hsl(152 62% 44%)",
    "hsl(280 60% 58%)",
    "hsl(330 70% 58%)",
  ],
};

function readToken(el: Element, name: string, fallback: string): string {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : fallback;
}

/**
 * Returns brand-matched chart colors plus a ref to attach to the chart's
 * outer element (so token resolution respects the nearest portal theme).
 */
export function useChartColors(): { colors: ChartColors; ref: React.RefObject<HTMLDivElement> } {
  const ref = useRef<HTMLDivElement>(null);
  const [colors, setColors] = useState<ChartColors>(SSR_DEFAULTS);

  useEffect(() => {
    const el = ref.current ?? document.body;
    if (!el) return;

    const resolve = () => {
      const next: ChartColors = {
        primary: readToken(el, "--primary", SSR_DEFAULTS.primary),
        accent: readToken(el, "--accent", SSR_DEFAULTS.accent),
        success: readToken(el, "--success", SSR_DEFAULTS.success),
        warning: readToken(el, "--warning", SSR_DEFAULTS.warning),
        info: readToken(el, "--info", SSR_DEFAULTS.info),
        destructive: readToken(el, "--destructive", SSR_DEFAULTS.destructive),
        muted: readToken(el, "--muted", SSR_DEFAULTS.muted),
        mutedForeground: readToken(el, "--muted-foreground", SSR_DEFAULTS.mutedForeground),
        border: readToken(el, "--border", SSR_DEFAULTS.border),
        foreground: readToken(el, "--foreground", SSR_DEFAULTS.foreground),
        surface: readToken(el, "--surface", SSR_DEFAULTS.surface),
        series: [
          readToken(el, "--primary", SSR_DEFAULTS.series[0]),
          readToken(el, "--accent", SSR_DEFAULTS.series[1]),
          readToken(el, "--info", SSR_DEFAULTS.series[2]),
          readToken(el, "--success", SSR_DEFAULTS.series[3]),
          "hsl(280 60% 58%)",
          "hsl(330 70% 58%)",
        ],
      };
      setColors(next);
    };

    resolve();

    // Re-resolve when the theme attribute flips (light/dark/portal switch).
    const observer = new MutationObserver(resolve);
    const themed = el.closest("[data-portal-theme]") ?? document.documentElement;
    observer.observe(themed, { attributes: true, attributeFilter: ["data-portal-theme", "class"] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return { colors, ref };
}
