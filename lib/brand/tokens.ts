/**
 * Brand tokens — the single source of truth every template renderer draws from
 * (rebrand doc 03 §1.4). Read from AppSettings so the rebrand is data, not code:
 * when the Estate design system lands, updating these values carries it to every
 * email, PDF, web view, and SMS signature automatically.
 *
 * Blocks reference tokens by path (e.g. "color.accent"), never literal hex.
 * - web/pdf renderers emit CSS custom properties from these tokens
 * - the email renderer resolves tokens to literal hex inline (Gmail/Outlook)
 */

import type { AppSettings } from "@/lib/settings";

export interface BrandTokens {
  color: {
    /** Primary brand ink — deep estate green. Reserved for actions/links. */
    primary: string;
    /** Body text. */
    ink: string;
    /** Muted/secondary text. */
    muted: string;
    /** Page background behind the content card. */
    surface: string;
    /** Content card background. */
    card: string;
    /** Champagne gold — eyebrows, rules, emphasis numerals. */
    accent: string;
    success: string;
    warning: string;
    danger: string;
    /** Hairline rule color. */
    rule: string;
  };
  font: {
    /** Email-safe serif display stack. */
    display: string;
    /** Email-safe body stack. */
    body: string;
  };
  radius: { card: number; chip: number };
  /** Base spacing unit in px; blocks use multiples. */
  spacing: number;
  logo: { url: string; documentUrl: string };
  identity: {
    companyName: string;
    abn: string;
    address: string;
    accountsEmail: string;
    supportEmail: string;
    phone: string;
  };
}

/** Estate defaults (rebrand doc 02) — used wherever settings are silent. */
export const DEFAULT_BRAND_TOKENS: BrandTokens = {
  color: {
    primary: "#1E4A3B",
    ink: "#22302B",
    muted: "#66756E",
    surface: "#F5F2EB",
    card: "#FFFFFF",
    accent: "#C0A265",
    success: "#2E7D5B",
    warning: "#A8742C",
    danger: "#8C3A38",
    rule: "#E4DFD3",
  },
  font: {
    display: "Georgia, 'Times New Roman', serif",
    body: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  radius: { card: 12, chip: 999 },
  spacing: 8,
  logo: { url: "", documentUrl: "" },
  identity: {
    companyName: "sNeek Property Services",
    abn: "",
    address: "",
    accountsEmail: "",
    supportEmail: "",
    phone: "",
  },
};

/**
 * Resolve the live token set from AppSettings. Pure mapping — no I/O — so the
 * renderers stay pure functions; callers fetch settings via getAppSettings().
 */
export function resolveBrandTokens(settings: AppSettings): BrandTokens {
  const d = DEFAULT_BRAND_TOKENS;
  return {
    ...d,
    logo: {
      url: settings.logoUrl || d.logo.url,
      documentUrl: settings.reportLogoUrl || settings.logoUrl || d.logo.documentUrl,
    },
    identity: {
      companyName: settings.companyName || d.identity.companyName,
      abn: settings.invoicing?.abn || d.identity.abn,
      address: settings.invoicing?.companyAddress || d.identity.address,
      accountsEmail: settings.accountsEmail || d.identity.accountsEmail,
      supportEmail: settings.accountsEmail || d.identity.supportEmail,
      phone: d.identity.phone,
    },
  };
}

/**
 * Look up a token by dotted path ("color.accent", "identity.companyName").
 * Returns undefined for unknown paths — callers decide the fallback.
 */
export function getToken(tokens: BrandTokens, path: string): string | number | undefined {
  const parts = path.split(".");
  let node: unknown = tokens;
  for (const part of parts) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || typeof node === "number" ? node : undefined;
}

/**
 * Resolve a style value that may be a token reference or a literal.
 * "color.accent" → "#C0A265"; "#123456" → "#123456".
 */
export function resolveTokenRef(tokens: BrandTokens, ref: string): string {
  const hit = getToken(tokens, ref);
  return hit !== undefined ? String(hit) : ref;
}

/** CSS custom properties for the web/pdf renderers. */
export function brandCssVars(tokens: BrandTokens): Record<string, string> {
  return {
    "--tpl-color-primary": tokens.color.primary,
    "--tpl-color-ink": tokens.color.ink,
    "--tpl-color-muted": tokens.color.muted,
    "--tpl-color-surface": tokens.color.surface,
    "--tpl-color-card": tokens.color.card,
    "--tpl-color-accent": tokens.color.accent,
    "--tpl-color-success": tokens.color.success,
    "--tpl-color-warning": tokens.color.warning,
    "--tpl-color-danger": tokens.color.danger,
    "--tpl-color-rule": tokens.color.rule,
    "--tpl-font-display": tokens.font.display,
    "--tpl-font-body": tokens.font.body,
  };
}
