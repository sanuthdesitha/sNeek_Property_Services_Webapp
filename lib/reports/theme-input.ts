/**
 * Validating a report theme save (board "Report themes", 2026-11-17): the
 * title may use only the three variables the generator fills, the footer is
 * stored as plain text, colours must read as HSL ("158 42% 20%"). PURE.
 */
import { footerPlainText, normalizeThemeLayout, parseHsl, TITLE_VARIABLES, unknownTitleVariables } from "./theme-rules";

export class ThemeInputError extends Error {}

export type ThemeData = {
  name?: string;
  layout?: unknown;
  logoUrl?: string | null;
  primaryColorHsl?: string | null;
  accentColorHsl?: string | null;
  titleTemplate?: string | null;
  footerHtml?: string | null;
  isActive?: boolean;
};

export function themeDataFromBody(body: Record<string, unknown>): ThemeData {
  const data: ThemeData = {};
  if (typeof body.name === "string") {
    if (!body.name.trim()) throw new ThemeInputError("A theme needs a name.");
    data.name = body.name.trim().slice(0, 120);
  }
  if (body.layout && typeof body.layout === "object") data.layout = normalizeThemeLayout(body.layout);
  if (body.logoUrl !== undefined) data.logoUrl = typeof body.logoUrl === "string" && body.logoUrl.trim() ? body.logoUrl.trim() : null;
  for (const key of ["primaryColorHsl", "accentColorHsl"] as const) {
    if (body[key] === undefined) continue;
    const value = typeof body[key] === "string" ? (body[key] as string).trim() : "";
    if (value && !parseHsl(value)) throw new ThemeInputError("Colours are written as hue, saturation and lightness, for example 158 42% 20%.");
    data[key] = value || null;
  }
  if (body.titleTemplate !== undefined) {
    const title = typeof body.titleTemplate === "string" ? body.titleTemplate.trim() : "";
    const unknown = unknownTitleVariables(title);
    if (unknown.length > 0) throw new ThemeInputError(`The title can use only ${TITLE_VARIABLES.join(", ")}. Remove ${unknown.join(", ")}.`);
    data.titleTemplate = title ? title.slice(0, 200) : null;
  }
  if (body.footerHtml !== undefined) {
    const text = footerPlainText(typeof body.footerHtml === "string" ? body.footerHtml : "");
    data.footerHtml = text || null;
  }
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  return data;
}
