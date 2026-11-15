/**
 * Report theme rules (board "Report themes", 2026-11-17). PURE: the editor,
 * the API and the report generator read the same definitions.
 *
 *  - Title: only the three variables the generator fills.
 *  - Footer: plain text with links (owner default): stored text has no tags;
 *    the generator escapes it and turns web addresses and emails into links,
 *    so a broken tag cannot break the PDF. An older HTML footer is shown and
 *    rendered as its text.
 *  - Colours start from the Estate colours (the same starting point as Email
 *    look) but are stored on the theme, separately.
 *  - Readability: contrast of white text on the main colour (WCAG ratio).
 */

export const TITLE_VARIABLES = ["{{job.jobNumber}}", "{{property.name}}", "{{job.scheduledFor | date short}}"] as const;

const TITLE_TOKEN = /\{\{\s*([^}]*?)\s*\}\}/g;
const ALLOWED_TITLE_EXPRESSIONS = new Set(["job.jobNumber", "property.name", "job.scheduledFor | date short"]);

/** Variables in a title that the generator does not fill (empty when all are allowed). */
export function unknownTitleVariables(title: string | null | undefined): string[] {
  if (!title) return [];
  const unknown: string[] = [];
  for (const match of Array.from(title.matchAll(TITLE_TOKEN))) {
    const expression = match[1].replace(/\s*\|\s*/g, " | ").trim();
    if (!ALLOWED_TITLE_EXPRESSIONS.has(expression)) unknown.push(match[0]);
  }
  return unknown;
}

export const ESTATE_REPORT_COLOURS = {
  primary: { hsl: "158 42% 20%", name: "Estate green" },
  accent: { hsl: "41 42% 57%", name: "Estate gold" },
} as const;

export const REPORT_SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "header", label: "Header (logo and title)" },
  { id: "summary", label: "Job summary" },
  { id: "qa-summary", label: "Quality inspection summary" },
  { id: "task-checklist", label: "Task checklist and admin tasks" },
  { id: "before-after-gallery", label: "Photo gallery" },
  { id: "supplies", label: "Supplies and stock" },
  { id: "signature", label: "Signature block" },
  { id: "footer", label: "Footer" },
];

export type ThemeSection = { id: string; visible: boolean; order: number; options?: Record<string, unknown> };
export type ThemeLayout = {
  sections: ThemeSection[];
  photoSize: "small" | "medium" | "large" | "hero";
  density: "compact" | "default" | "comfortable";
  template?: "classic" | "luxury" | "estate";
};

const PHOTO_SIZES = ["small", "medium", "large", "hero"] as const;
const DENSITIES = ["compact", "default", "comfortable"] as const;
const TEMPLATES = ["estate", "classic", "luxury"] as const;

/**
 * A complete layout: every known section once (a section the stored layout
 * lacks is visible, which is how the generator already treats it), unknown
 * sections kept, sorted by order.
 */
export function normalizeThemeLayout(raw: unknown): ThemeLayout {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const stored = Array.isArray(value.sections) ? (value.sections as unknown[]).filter((s): s is ThemeSection => Boolean(s) && typeof s === "object" && typeof (s as ThemeSection).id === "string") : [];
  const sections: ThemeSection[] = stored.map((section, index) => ({ ...section, visible: section.visible !== false, order: typeof section.order === "number" ? section.order : index }));
  let next = sections.reduce((max, section) => Math.max(max, section.order), -1) + 1;
  for (const known of REPORT_SECTIONS) {
    if (!sections.some((section) => section.id === known.id)) sections.push({ id: known.id, visible: true, order: next++ });
  }
  sections.sort((a, b) => a.order - b.order);
  return {
    ...(value as object),
    sections: sections.map((section, index) => ({ ...section, order: index })),
    photoSize: (PHOTO_SIZES as readonly string[]).includes(String(value.photoSize)) ? (value.photoSize as ThemeLayout["photoSize"]) : "medium",
    density: (DENSITIES as readonly string[]).includes(String(value.density)) ? (value.density as ThemeLayout["density"]) : "default",
    ...((TEMPLATES as readonly string[]).includes(String(value.template)) ? { template: value.template as ThemeLayout["template"] } : {}),
  };
}

/** The footer as plain text: tags dropped, entities decoded, whitespace tidied. */
export function footerPlainText(stored: string | null | undefined): string {
  if (!stored) return "";
  return stored
    .replace(/<br\s*\/?>/gi, " · ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<|>/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 600);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LINK = /(https?:\/\/[^\s<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Footer text for the report document: escaped, with web addresses and emails as links. */
export function footerTextToHtml(stored: string | null | undefined): string {
  const text = footerPlainText(stored);
  if (!text) return "";
  let out = "";
  let last = 0;
  for (const match of Array.from(text.matchAll(LINK))) {
    const index = match.index ?? 0;
    out += escapeHtml(text.slice(last, index));
    const target = match[0];
    const href = target.includes("@") && !target.startsWith("http") ? `mailto:${target}` : target;
    out += `<a href="${escapeHtml(href)}">${escapeHtml(target)}</a>`;
    last = index + target.length;
  }
  return out + escapeHtml(text.slice(last));
}

/** "158 42% 20%" → [h, s, l] (0–360, 0–1, 0–1), or null. */
export function parseHsl(value: string | null | undefined): [number, number, number] | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*,?\s+(\d+(?:\.\d+)?)%\s*,?\s+(\d+(?:\.\d+)?)%\s*$/.exec(value ?? "");
  if (!match) return null;
  const [h, s, l] = [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
  if (h > 360 || s > 1 || l > 1) return null;
  return [h, s, l];
}

export function hslToHex(value: string | null | undefined): string | null {
  const parsed = parseHsl(value);
  if (!parsed) return null;
  const [h, s, l] = parsed;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const colour = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(colour * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** "#1e4a38" → "158 42% 20%" (rounded). */
export function hexToHsl(hex: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast of white text on an HSL colour, e.g. 10.1; null when the colour cannot be read. */
export function whiteTextContrast(value: string | null | undefined): number | null {
  const hex = hslToHex(value);
  if (!hex) return null;
  const ratio = 1.05 / (luminance(hex) + 0.05);
  return Math.round(ratio * 10) / 10;
}

/** WCAG AA for normal text. */
export const READABLE_CONTRAST = 4.5;
