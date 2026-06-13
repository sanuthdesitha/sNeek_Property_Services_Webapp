"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { FormTheme } from "@/lib/forms/types";

/**
 * Scopes a form template's optional appearance overrides (`schema.theme`) to a
 * single container WITHOUT leaking into the surrounding portal chrome. Theme
 * colours are applied as inline CSS variables on a wrapper div and ALSO mapped
 * onto the design-system tokens (`--primary` / `--ring`) so existing
 * `bg-primary` / `accent-primary` usages inside the renderer pick up the
 * accent. Because the override is scoped to this wrapper, the rest of the app
 * keeps the global tokens.
 *
 * Everything is optional and degrades to the default tokens when the theme is
 * absent — fully backward compatible with un-themed templates.
 */

const FormThemeContext = React.createContext<FormTheme | undefined>(undefined);

/** Read the active form theme (if any) from a descendant component. */
export function useFormTheme(): FormTheme | undefined {
  return React.useContext(FormThemeContext);
}

// Converts a hex colour (#rgb / #rrggbb) to a space-separated HSL triple so it
// can drive the `--primary`/`--ring` HSL tokens used across the renderer. Falls
// back to leaving the raw value alone for non-hex colour strings (rgb/hsl/named
// colours still work via the dedicated `--form-accent` variable below).
function hexToHslTriple(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let value = m[1];
  if (value.length === 3) {
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function buildFormThemeStyle(theme: FormTheme | undefined): React.CSSProperties {
  if (!theme) return {};
  const style: React.CSSProperties & Record<string, string> = {};
  if (theme.accentColor) {
    style["--form-accent"] = theme.accentColor;
    const triple = hexToHslTriple(theme.accentColor);
    if (triple) {
      // Re-point the scoped design tokens so themed accent flows through every
      // `bg-primary` / `accent-primary` inside the form body only.
      style["--primary"] = triple;
      style["--ring"] = triple;
    }
  }
  if (theme.headerColor) style["--form-header"] = theme.headerColor;
  if (theme.headingFont) style["--form-heading-font"] = theme.headingFont;
  if (theme.bodyFont) {
    style["--form-body-font"] = theme.bodyFont;
    style.fontFamily = theme.bodyFont;
  }
  return style;
}

export interface FormThemeScopeProps {
  theme: FormTheme | undefined;
  children: React.ReactNode;
  className?: string;
  /** Render the themed logo header above the children (default true). */
  showLogo?: boolean;
}

/**
 * Wraps form content in a theme-scoped container. Renders the optional logo
 * header and exposes the theme to descendants via context.
 */
export function FormThemeScope({ theme, children, className, showLogo = true }: FormThemeScopeProps) {
  const style = React.useMemo(() => buildFormThemeStyle(theme), [theme]);

  return (
    <FormThemeContext.Provider value={theme}>
      <div className={cn("form-theme-scope", className)} style={style}>
        {showLogo && theme?.logoUrl ? (
          <div className="mb-4 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={theme.logoUrl}
              alt="Form logo"
              className="max-h-16 w-auto object-contain"
            />
          </div>
        ) : null}
        {children}
      </div>
    </FormThemeContext.Provider>
  );
}

/**
 * A themed section heading. Uses the theme header colour + heading font when
 * present, with the optional divider line below. Falls back to plain styles
 * when no theme is set.
 */
export function ThemedSectionHeading({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  const theme = useFormTheme();
  const headingStyle: React.CSSProperties = {};
  if (theme?.headerColor) headingStyle.color = theme.headerColor;
  if (theme?.headingFont) headingStyle.fontFamily = theme.headingFont;

  return (
    <div className={className}>
      <p className="text-sm font-semibold" style={headingStyle}>
        {title}
      </p>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      {theme?.showDividers ? (
        <div
          className="mt-2 h-px w-full"
          style={{
            backgroundColor: theme.accentColor ?? "hsl(var(--border))",
            opacity: theme.accentColor ? 0.35 : 1,
          }}
        />
      ) : null}
    </div>
  );
}
