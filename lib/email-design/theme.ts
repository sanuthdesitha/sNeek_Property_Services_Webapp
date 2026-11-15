/**
 * "Email look": presets, the contrast check and the derived light and dark
 * palettes. Plain module. Nobody picks text, callout or dark-mode colours by
 * hand: they are fixed here and checked; only the brand colour changes, and a
 * brand colour that cannot carry button text at 4.5:1 cannot be saved.
 */
import { BUTTON_SHAPES, COLOUR_PRESET_IDS, HEADING_STYLES, type ButtonShape, type ColourPresetId, type EmailTheme, type HeadingStyle } from "./types";

export type ColourPreset = { id: Exclude<ColourPresetId, "custom">; label: string; color: string };

/** Estate deep green first (owner default, pending confirmation). */
export const COLOUR_PRESETS: readonly ColourPreset[] = [
  { id: "forest", label: "Forest", color: "#1E4A38" },
  { id: "harbour", label: "Harbour", color: "#1F4E6B" },
  { id: "eucalypt", label: "Eucalypt", color: "#2F5D50" },
  { id: "ink", label: "Ink", color: "#26302C" },
  { id: "shiraz", label: "Shiraz", color: "#6B2737" },
];

export const DEFAULT_EMAIL_THEME: EmailTheme = {
  preset: "forest",
  brandColor: "#1E4A38",
  buttonShape: "rounded",
  headingStyle: "serif",
  logoUrl: "",
  logoDarkUrl: "",
  senderName: "",
  replyTo: "",
  footerExtra: "",
};

export const FOOTER_EXTRA_LIMIT = 140;
export const MIN_BUTTON_CONTRAST = 4.5;

/** Button text colour on the brand colour (light mode). */
export const BUTTON_TEXT_LIGHT = "#FFFDF7";
/** Button text colour on the derived brand colour (dark mode). */
export const BUTTON_TEXT_DARK = "#0D1F16";

/** Every colour the sent HTML uses, for one scheme. */
export type EmailPalette = {
  page: string;
  card: string;
  ink: string;
  text: string;
  muted: string;
  line: string;
  sunken: string;
  brand: string;
  brandText: string;
  brandSoft: string;
  callout: Record<"note" | "action" | "problem" | "done", { bg: string; fg: string }>;
};

const LIGHT_BASE = {
  page: "#F5F1E8", card: "#FFFFFF", ink: "#17221D", text: "#36423C", muted: "#5B6660", line: "#E4DED2", sunken: "#F3EFE6",
  callout: { note: { bg: "#E5EEF5", fg: "#24496A" }, action: { bg: "#FBF0D9", fg: "#6A4710" }, problem: { bg: "#F8E3E0", fg: "#8A2A20" }, done: { bg: "#E3F1E8", fg: "#1F5A3A" } },
};

const DARK_BASE = {
  page: "#0F1512", card: "#18201C", ink: "#EEEAE0", text: "#D6D3CA", muted: "#A7AEA9", line: "#2C3631", sunken: "#202924",
  callout: { note: { bg: "#172A3A", fg: "#B5D3EE" }, action: { bg: "#3A2E14", fg: "#F2D9A2" }, problem: { bg: "#3D1E1A", fg: "#F4B8AE" }, done: { bg: "#173326", fg: "#A9DDBF" } },
};

export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Rounded down to one decimal, so "4.5:1" shown never overstates a 4.49 ratio. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

function mix(hex: string, target: string, amount: number): string {
  const from = channels(hex);
  const to = channels(target);
  return toHex([0, 1, 2].map((index) => from[index] + (to[index] - from[index]) * amount) as [number, number, number]);
}

export type BrandCheck = {
  ok: boolean;
  ratio: number;
  /** The nearest darker shade that passes, when this one fails. */
  suggestion: string | null;
  suggestionRatio: number | null;
};

/** Does button text (#FFFDF7) on this colour reach 4.5:1? If not, the nearest darker shade that does. */
export function checkBrandColour(color: string): BrandCheck {
  if (!isHexColour(color)) return { ok: false, ratio: 0, suggestion: null, suggestionRatio: null };
  const ratio = contrastRatio(color, BUTTON_TEXT_LIGHT);
  if (ratio >= MIN_BUTTON_CONTRAST) return { ok: true, ratio, suggestion: null, suggestionRatio: null };
  for (let step = 1; step <= 40; step += 1) {
    const candidate = mix(color, "#000000", step * 0.025);
    const candidateRatio = contrastRatio(candidate, BUTTON_TEXT_LIGHT);
    if (candidateRatio >= MIN_BUTTON_CONTRAST + 0.2) return { ok: false, ratio, suggestion: candidate, suggestionRatio: candidateRatio };
  }
  return { ok: false, ratio, suggestion: null, suggestionRatio: null };
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/**
 * The brand colour for dark mode: the same hue, lightened (and kept gently
 * saturated) until it reads on the dark card and carries dark button text at
 * 4.5:1. Forest #1E4A38 becomes a soft sage close to the board's #8CC5A6.
 */
export function darkBrand(color: string): string {
  const base = isHexColour(color) ? color : DEFAULT_EMAIL_THEME.brandColor;
  const [h, s] = toHsl(base);
  const saturation = Math.max(0.22, Math.min(0.42, s * 0.85));
  for (let step = 0; step <= 30; step += 1) {
    const candidate = fromHsl(h, saturation, 0.6 + step * 0.01);
    if (contrastRatio(candidate, DARK_BASE.card) >= MIN_BUTTON_CONTRAST && contrastRatio(candidate, BUTTON_TEXT_DARK) >= MIN_BUTTON_CONTRAST) return candidate;
  }
  return "#8CC5A6";
}

export function lightPalette(theme: EmailTheme): EmailPalette {
  const brand = isHexColour(theme.brandColor) && checkBrandColour(theme.brandColor).ok ? theme.brandColor.toUpperCase() : DEFAULT_EMAIL_THEME.brandColor;
  return { ...LIGHT_BASE, brand, brandText: BUTTON_TEXT_LIGHT, brandSoft: mix(brand, "#FFFFFF", 0.88) };
}

export function darkPalette(theme: EmailTheme): EmailPalette {
  const light = lightPalette(theme);
  const brand = darkBrand(light.brand);
  return { ...DARK_BASE, brand, brandText: BUTTON_TEXT_DARK, brandSoft: mix(light.brand, DARK_BASE.card, 0.7) };
}

export type ContrastReport = { label: string; light: number; dark: number; minimum: number; ok: boolean };

/** The checks shown on publish ("Checked on every publish"). */
export function themeContrastReport(theme: EmailTheme): ContrastReport[] {
  const light = lightPalette(theme);
  const dark = darkPalette(theme);
  const row = (label: string, minimum: number, l: [string, string], d: [string, string]): ContrastReport => {
    const lightRatio = contrastRatio(...l);
    const darkRatio = contrastRatio(...d);
    return { label, light: lightRatio, dark: darkRatio, minimum, ok: lightRatio >= minimum && darkRatio >= minimum };
  };
  return [
    row("Body text on card", 4.5, [light.text, light.card], [dark.text, dark.card]),
    row("Muted text", 4.5, [light.muted, light.card], [dark.muted, dark.card]),
    row("Button text", 4.5, [light.brandText, light.brand], [dark.brandText, dark.brand]),
    row("Links on card", 4.5, [light.brand, light.card], [dark.brand, dark.card]),
    ...(["note", "action", "problem", "done"] as const).map((tone) => row(`Callout text (${tone})`, 4.5, [light.callout[tone].fg, light.callout[tone].bg], [dark.callout[tone].fg, dark.callout[tone].bg])),
  ];
}

export type ThemeProblem = { field: keyof EmailTheme; message: string };

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";
}

function cleanUrl(value: unknown): string {
  const text = cleanText(value, 1000);
  return /^(https:\/\/|\/)/i.test(text) ? text : "";
}

const EMAIL_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** Validation for a theme someone wants to save (a failing custom colour cannot be saved). */
export function themeProblems(theme: EmailTheme): ThemeProblem[] {
  const problems: ThemeProblem[] = [];
  const check = checkBrandColour(theme.brandColor);
  if (!isHexColour(theme.brandColor)) problems.push({ field: "brandColor", message: "Enter a colour as # and six hex digits." });
  else if (!check.ok) problems.push({ field: "brandColor", message: `Button text on this colour is ${formatRatio(check.ratio)}; it must reach 4.5:1.${check.suggestion ? ` The nearest shade that passes is ${check.suggestion}.` : ""}` });
  if (theme.replyTo && !EMAIL_PATTERN.test(theme.replyTo)) problems.push({ field: "replyTo", message: "Reply-to must be one email address." });
  if (theme.footerExtra.length > FOOTER_EXTRA_LIMIT) problems.push({ field: "footerExtra", message: `The extra footer line can be at most ${FOOTER_EXTRA_LIMIT} characters.` });
  if (/[<>]/.test(theme.senderName)) problems.push({ field: "senderName", message: "The sender name cannot contain < or >." });
  return problems;
}

/** Anything stored or sent is reduced to a valid theme (unknown parts fall back to the default). */
export function sanitizeTheme(value: unknown): EmailTheme {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const preset = COLOUR_PRESET_IDS.includes(row.preset as ColourPresetId) ? (row.preset as ColourPresetId) : DEFAULT_EMAIL_THEME.preset;
  const presetColour = COLOUR_PRESETS.find((item) => item.id === preset)?.color;
  const brandColor = presetColour ?? (isHexColour(row.brandColor) ? (row.brandColor as string).toUpperCase() : DEFAULT_EMAIL_THEME.brandColor);
  return {
    preset,
    brandColor,
    buttonShape: BUTTON_SHAPES.includes(row.buttonShape as ButtonShape) ? (row.buttonShape as ButtonShape) : DEFAULT_EMAIL_THEME.buttonShape,
    headingStyle: HEADING_STYLES.includes(row.headingStyle as HeadingStyle) ? (row.headingStyle as HeadingStyle) : DEFAULT_EMAIL_THEME.headingStyle,
    logoUrl: cleanUrl(row.logoUrl),
    logoDarkUrl: cleanUrl(row.logoDarkUrl),
    senderName: cleanText(row.senderName, 80),
    replyTo: cleanText(row.replyTo, 200),
    footerExtra: cleanText(row.footerExtra, FOOTER_EXTRA_LIMIT + 60),
  };
}

export const BUTTON_RADIUS: Record<ButtonShape, number> = { square: 2, rounded: 8, pill: 999 };
