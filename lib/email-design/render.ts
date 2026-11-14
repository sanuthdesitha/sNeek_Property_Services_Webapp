/**
 * THE email renderer: one base layout, twelve blocks, one theme. Plain module
 * (runs in the browser for the live preview and on the server at send time).
 *
 * Output:
 * - Outlook-safe table HTML: 600px card, one row per block, inline styles,
 *   VML button for Outlook, no flex, grid or CSS variables;
 * - a dark-mode stylesheet (prefers-color-scheme and Outlook.com's data-ogsc)
 *   from the derived dark palette; `scheme: "dark"` inlines it for previews;
 * - the plain-text part generated from the same blocks;
 * - `missing`: required values that are empty. A send with missing values is
 *   refused by the send path; a preview shows a visible placeholder instead.
 *
 * Every value is escaped. "built" values are fragments this codebase built and
 * escaped itself; "url" values are only used when they are http(s), mailto or tel.
 */
import { CALLOUT_WORD, type BusinessDetails, type EmailBlock, type EmailDesignDefinition, type EmailDocument, type EmailTheme, type EmailVariable, type Inline } from "./types";
import { BUTTON_RADIUS, darkPalette, lightPalette, type EmailPalette } from "./theme";
import { isInlineEmpty } from "./inline";

export type RenderScheme = "auto" | "light" | "dark";

export type RenderDefinition = Pick<EmailDesignDefinition, "key" | "variables" | "whyLine" | "preferences" | "security">;

export type RenderOptions = {
  theme: EmailTheme;
  business: BusinessDetails;
  definition: RenderDefinition;
  /** "preview" shows missing required values as visible placeholders. */
  mode: "send" | "preview";
  scheme?: RenderScheme;
  /** Absolute link for "Email preferences"; omitted = no link. */
  preferencesUrl?: string | null;
  /** Marketing only: the signed one-click unsubscribe link. */
  unsubscribeUrl?: string | null;
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** Labels of required values that are empty. */
  missing: string[];
  /** Names of required values that are empty. */
  missingNames: string[];
};

export type LineItemRow = { label: string; value: string; kind?: "item" | "sub" | "total" };
export type LineItemsValue = { head?: [string, string]; rows: LineItemRow[] };
export type PhotoValue = { url: string; caption: string };

const SANS = `Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif`;
const SERIF = `Fraunces,Georgia,'Times New Roman',serif`;
const MONO = `'JetBrains Mono',Consolas,'Courier New',monospace`;

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only links that are safe to put in an href. */
export function safeHref(value: string): string | null {
  const url = value.trim();
  return /^(https?:\/\/|mailto:|tel:)[^\s<>"']+$/i.test(url) ? url : null;
}

export function parseLineItems(value: string): LineItemsValue | null {
  try {
    const parsed = JSON.parse(value) as Partial<LineItemsValue>;
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    const rows = parsed.rows.flatMap((row): LineItemRow[] => {
      if (!row || typeof row !== "object" || typeof row.label !== "string" || typeof row.value !== "string") return [];
      const kind = row.kind === "sub" || row.kind === "total" ? row.kind : "item";
      return [{ label: row.label, value: row.value, kind }];
    });
    if (rows.length === 0) return null;
    const head = Array.isArray(parsed.head) && parsed.head.length === 2 ? [String(parsed.head[0]), String(parsed.head[1])] as [string, string] : undefined;
    return { head, rows };
  } catch {
    return null;
  }
}

export function parsePhotos(value: string): PhotoValue[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): PhotoValue[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const url = typeof row.url === "string" ? safeHref(row.url) : null;
      return url && /^https?:/i.test(url) ? [{ url, caption: typeof row.caption === "string" ? row.caption : "" }] : [];
    }).slice(0, 4);
  } catch {
    return [];
  }
}

/** A crude but safe HTML → text for "built" fragments that have no text twin. */
export function fragmentToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|tr|h\d|ul|ol|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

type Ctx = {
  options: RenderOptions;
  values: Record<string, string>;
  vars: Map<string, EmailVariable>;
  p: EmailPalette;
  missing: Map<string, string>;
};

function rawValue(ctx: Ctx, name: string): string {
  return String(ctx.values[name] ?? "").trim();
}

/** Present = non-empty, and for structured formats, parsable with content. */
export function valuePresent(variable: EmailVariable | undefined, raw: string): boolean {
  if (!raw) return false;
  if (variable?.format === "rows") return parseLineItems(raw) !== null;
  if (variable?.format === "photos") return parsePhotos(raw).length > 0;
  if (variable?.format === "url") return safeHref(raw) !== null;
  return true;
}

function present(ctx: Ctx, name: string): boolean {
  return valuePresent(ctx.vars.get(name), rawValue(ctx, name));
}

function noteMissing(ctx: Ctx, name: string): void {
  const variable = ctx.vars.get(name);
  if (variable?.required) ctx.missing.set(name, variable.label);
}

function placeholderHtml(ctx: Ctx, name: string): string {
  const label = ctx.vars.get(name)?.label ?? name;
  return `<span style="background:${ctx.p.callout.action.bg};color:${ctx.p.callout.action.fg};border-radius:4px;padding:0 4px;font-weight:600">[${escapeHtml(label)} missing]</span>`;
}

function valueHtml(ctx: Ctx, name: string, bold: boolean): string {
  const variable = ctx.vars.get(name);
  const raw = rawValue(ctx, name);
  if (!valuePresent(variable, raw)) {
    if (variable?.required) {
      noteMissing(ctx, name);
      return ctx.options.mode === "preview" ? placeholderHtml(ctx, name) : "";
    }
    return escapeHtml(variable?.fallback ?? "Not known");
  }
  let html: string;
  switch (variable?.format) {
    case "built":
      html = raw;
      break;
    case "multiline":
      html = escapeHtml(raw).replace(/\r?\n/g, "<br>");
      break;
    case "url": {
      const href = safeHref(raw) as string;
      html = `<a href="${escapeHtml(href)}" class="sn-br" style="color:${ctx.p.brand};text-decoration:underline;word-break:break-all">${escapeHtml(href.replace(/^https?:\/\//i, ""))}</a>`;
      break;
    }
    default:
      html = escapeHtml(raw);
  }
  return bold ? `<strong class="sn-ink" style="font-weight:600;color:${ctx.p.ink}">${html}</strong>` : html;
}

function valueText(ctx: Ctx, name: string): string {
  const variable = ctx.vars.get(name);
  const raw = rawValue(ctx, name);
  if (!valuePresent(variable, raw)) {
    if (variable?.required) {
      noteMissing(ctx, name);
      return ctx.options.mode === "preview" ? `[${variable.label} missing]` : "";
    }
    return variable?.fallback ?? "Not known";
  }
  if (variable?.format === "built") {
    const twin = variable.textTwin ? rawValue(ctx, variable.textTwin) : "";
    return twin || fragmentToText(raw);
  }
  return raw;
}

export function inlineHtml(ctx: Ctx, text: Inline): string {
  return text.map((segment) => {
    if (segment.kind === "value") return valueHtml(ctx, segment.name, Boolean(segment.bold));
    const escaped = escapeHtml(segment.text).replace(/\r?\n/g, "<br>");
    return segment.bold ? `<strong class="sn-ink" style="font-weight:600;color:${ctx.p.ink}">${escaped}</strong>` : escaped;
  }).join("");
}

function inlineText(ctx: Ctx, text: Inline): string {
  return text.map((segment) => (segment.kind === "value" ? valueText(ctx, segment.name) : segment.text)).join("");
}

/** True when every value in this run is empty and optional (a details row then hides). */
function allValuesAbsent(ctx: Ctx, text: Inline): boolean {
  const values = text.filter((segment) => segment.kind === "value");
  return values.length > 0 && values.every((segment) => segment.kind === "value" && !present(ctx, segment.name) && !ctx.vars.get(segment.name)?.required);
}

function blockVisible(ctx: Ctx, block: EmailBlock): boolean {
  if (block.showIf && !present(ctx, block.showIf)) return false;
  return true;
}

const PAD_X = 32;

function row(content: string, padding = `0 ${PAD_X}px 16px`): string {
  return `<tr><td class="sn-px" style="padding:${padding}">${content}</td></tr>`;
}

function paragraphStyle(ctx: Ctx, size = 15, color = ctx.p.text, cls = "sn-tx"): string {
  return `class="${cls}" style="margin:0;font-family:${SANS};font-size:${size}px;line-height:1.6;color:${color}"`;
}

function headingFont(ctx: Ctx): string {
  return ctx.options.theme.headingStyle === "sans" ? SANS : SERIF;
}

type BlockOut = { html: string; text: string[] };

function renderHeading(ctx: Ctx, text: Inline, first: boolean): BlockOut {
  const html = inlineHtml(ctx, text);
  const plain = inlineText(ctx, text);
  if (first) {
    return {
      html: row(`<h1 class="sn-ink sn-h1" style="margin:0;font-family:${headingFont(ctx)};font-weight:500;font-size:26px;line-height:1.25;color:${ctx.p.ink}">${html}</h1>`, `24px ${PAD_X}px 14px`),
      text: [plain.toUpperCase()],
    };
  }
  return { html: row(`<h2 class="sn-ink" style="margin:0;font-family:${headingFont(ctx)};font-weight:500;font-size:19px;line-height:1.3;color:${ctx.p.ink}">${html}</h2>`), text: [plain] };
}

function renderDetails(ctx: Ctx, block: Extract<EmailBlock, { type: "details" }>): BlockOut | null {
  const rows = block.rows.filter((item) => !isInlineEmpty(item.value) && !allValuesAbsent(ctx, item.value));
  if (rows.length === 0) return null;
  const labelWidth = Math.max(...rows.map((item) => item.label.length));
  const htmlRows = rows.map((item, index) => {
    const border = index === 0 ? "" : `border-top:1px solid ${ctx.p.line};`;
    return `<tr><td class="sn-dl-l sn-mu sn-ln" width="132" valign="top" style="${border}width:132px;padding:8px 12px 8px 14px;font-family:${SANS};font-size:14px;line-height:1.5;color:${ctx.p.muted}">${escapeHtml(item.label)}</td><td class="sn-dl-v sn-ink sn-ln" valign="top" style="${border}padding:8px 14px 8px 0;font-family:${SANS};font-size:14px;line-height:1.5;font-weight:500;color:${ctx.p.ink};word-break:break-word">${inlineHtml(ctx, item.value)}</td></tr>`;
  }).join("");
  return {
    html: row(`<table role="presentation" class="sn-dl sn-ln" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${ctx.p.line};border-radius:8px">${htmlRows}</table>`),
    text: rows.map((item) => `${item.label.padEnd(labelWidth + 2, " ")}${inlineText(ctx, item.value)}`),
  };
}

function renderLineItems(ctx: Ctx, block: Extract<EmailBlock, { type: "lineItems" }>): BlockOut | null {
  const variable = ctx.vars.get(block.source);
  const raw = rawValue(ctx, block.source);
  if (!valuePresent(variable, raw)) {
    if (variable?.required) {
      noteMissing(ctx, block.source);
      return ctx.options.mode === "preview" ? { html: row(placeholderHtml(ctx, block.source)), text: [] } : null;
    }
    return null;
  }
  if (variable?.format === "built") {
    return { html: row(`<div class="sn-tx" style="font-family:${SANS};font-size:14px;line-height:1.6;color:${ctx.p.text}">${raw}</div>`), text: [valueText(ctx, block.source)] };
  }
  const items = parseLineItems(raw) as LineItemsValue;
  const head = items.head ?? ["Item", "Amount"];
  const cell = (content: string, opts: { right?: boolean; strong?: boolean; muted?: boolean; border?: boolean }) =>
    `<td class="${opts.muted ? "sn-mu" : opts.strong ? "sn-ink" : "sn-tx"} sn-ln"${opts.right ? ' align="right"' : ""} valign="top" style="padding:${opts.muted ? "3px" : "8px"} 0 ${opts.muted ? "3px" : "8px"} ${opts.right ? "10px" : "0"};${opts.border ? `border-bottom:1px solid ${ctx.p.line};` : ""}font-family:${SANS};font-size:14px;line-height:1.5;color:${opts.muted ? ctx.p.muted : opts.strong ? ctx.p.ink : ctx.p.text};${opts.strong ? "font-weight:600;" : ""}${opts.right ? "white-space:nowrap;" : ""}">${content}</td>`;
  const headRow = `<tr><th align="left" class="sn-mu sn-ln" style="padding:6px 0;border-bottom:1px solid ${ctx.p.line};font-family:${SANS};font-size:11.5px;font-weight:600;color:${ctx.p.muted}">${escapeHtml(head[0])}</th><th align="right" class="sn-mu sn-ln" style="padding:6px 0;border-bottom:1px solid ${ctx.p.line};font-family:${SANS};font-size:11.5px;font-weight:600;color:${ctx.p.muted}">${escapeHtml(head[1])}</th></tr>`;
  const bodyRows = items.rows.map((item) => {
    const kind = item.kind ?? "item";
    return `<tr>${cell(escapeHtml(item.label), { strong: kind === "total", muted: kind === "sub", border: kind === "item" })}${cell(escapeHtml(item.value), { right: true, strong: kind === "total", muted: kind === "sub", border: kind === "item" })}</tr>`;
  }).join("");
  const width = Math.max(...items.rows.map((item) => item.label.length), head[0].length);
  return {
    html: row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${headRow}${bodyRows}</table>`),
    text: [`${head[0].padEnd(width + 2)}${head[1]}`, ...items.rows.map((item) => `${item.label.padEnd(width + 2)}${item.value}`)],
  };
}

function renderButton(ctx: Ctx, block: Extract<EmailBlock, { type: "button" }>): BlockOut | null {
  const variable = ctx.vars.get(block.link);
  const raw = rawValue(ctx, block.link);
  const href = safeHref(raw);
  if (!href) {
    if (variable?.required) {
      noteMissing(ctx, block.link);
      return ctx.options.mode === "preview" ? { html: row(placeholderHtml(ctx, block.link)), text: [] } : null;
    }
    return null;
  }
  const labelText = (block.labelValue && rawValue(ctx, block.labelValue)) || block.label;
  const label = escapeHtml(labelText);
  const radius = BUTTON_RADIUS[ctx.options.theme.buttonShape];
  const arc = ctx.options.theme.buttonShape === "pill" ? 50 : ctx.options.theme.buttonShape === "square" ? 0 : 17;
  const vmlWidth = Math.max(160, Math.min(520, labelText.length * 9 + 56));
  const escapedHref = escapeHtml(href);
  const display = escapeHtml(href.replace(/^https?:\/\//i, ""));
  const button = `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapedHref}" style="height:46px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="${arc}%" stroke="f" fillcolor="${ctx.p.brand}"><w:anchorlock/><center style="color:${ctx.p.brandText};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a href="${escapedHref}" target="_blank" rel="noopener" class="sn-btn sn-btn-a" style="display:inline-block;background:${ctx.p.brand};color:${ctx.p.brandText};font-family:${SANS};font-size:15px;font-weight:600;line-height:20px;padding:13px 24px;border-radius:${radius}px;text-decoration:none;mso-hide:all">${label}</a><!--<![endif]-->`;
  const or = `<p class="sn-mu" style="margin:8px 0 0;font-family:${SANS};font-size:12.5px;line-height:1.5;color:${ctx.p.muted};word-break:break-all">Or open <a href="${escapedHref}" class="sn-br" style="color:${ctx.p.brand};text-decoration:underline">${display}</a></p>`;
  return { html: row(`${button}${or}`, `4px ${PAD_X}px 18px`), text: [`${labelText}:`, href] };
}

function renderCallout(ctx: Ctx, block: Extract<EmailBlock, { type: "callout" }>): BlockOut {
  const tone = ctx.p.callout[block.tone];
  const icon = block.tone === "done" ? "&#10003;" : block.tone === "note" ? "i" : "!";
  const word = CALLOUT_WORD[block.tone];
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sn-cl-${block.tone}" style="border-collapse:separate;background:${tone.bg};border-radius:8px"><tr><td width="34" valign="top" style="width:34px;padding:12px 0 12px 14px"><span class="sn-cl-${block.tone}-i" style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:${tone.fg};color:${tone.bg};font-family:${SANS};font-size:12px;font-weight:700;text-align:center">${icon}</span></td><td valign="top" class="sn-cl-${block.tone}-t" style="padding:11px 14px 11px 0;font-family:${SANS};font-size:14px;line-height:1.55;color:${tone.fg}"><strong style="font-weight:600">${escapeHtml(word)}:</strong> ${inlineHtml(ctx, block.text)}</td></tr></table>`;
  return { html: row(html), text: [`${word.toUpperCase()}: ${inlineText(ctx, block.text)}`] };
}

function renderPhotos(ctx: Ctx, block: Extract<EmailBlock, { type: "photos" }>): BlockOut | null {
  const photos = parsePhotos(rawValue(ctx, block.source));
  if (photos.length === 0) return null;
  if (photos.length === 1) {
    const photo = photos[0];
    return {
      html: row(`<img src="${escapeHtml(photo.url)}" width="536" alt="${escapeHtml(photo.caption || "Image")}" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:6px">${isInlineEmpty(block.caption) ? "" : `<p class="sn-mu" style="margin:8px 0 0;font-family:${SANS};font-size:12.5px;line-height:1.5;color:${ctx.p.muted}">${inlineHtml(ctx, block.caption)}</p>`}`),
      text: [`Image: ${photo.caption || photo.url}`],
    };
  }
  const filler = Array.from({ length: 4 - photos.length }, () => `<td width="25%" style="width:25%;padding:0 4px">&nbsp;</td>`).join("");
  const cells = photos.map((photo) => `<td width="25%" valign="top" style="width:25%;padding:0 4px"><img src="${escapeHtml(photo.url)}" width="125" alt="${escapeHtml(photo.caption || "Photo from the job")}" style="display:block;width:100%;max-width:125px;height:auto;border:0;border-radius:6px"><p class="sn-mu" style="margin:4px 0 0;font-family:${SANS};font-size:11.5px;line-height:1.4;color:${ctx.p.muted}">${escapeHtml(photo.caption)}</p></td>`).join("") + filler;
  const caption = isInlineEmpty(block.caption) ? "" : `<p class="sn-mu" style="margin:8px 0 0;font-family:${SANS};font-size:12.5px;line-height:1.5;color:${ctx.p.muted}">${inlineHtml(ctx, block.caption)}</p>`;
  return {
    html: row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -4px"><tr>${cells}</tr></table>${caption}`),
    text: [...photos.map((photo) => `Photo: ${photo.caption}`.trim()), ...(isInlineEmpty(block.caption) ? [] : [inlineText(ctx, block.caption)])],
  };
}

function renderCode(ctx: Ctx, block: Extract<EmailBlock, { type: "code" }>): BlockOut | null {
  const raw = rawValue(ctx, block.source);
  if (!raw) {
    noteMissing(ctx, block.source);
    return ctx.options.mode === "preview" ? { html: row(placeholderHtml(ctx, block.source)), text: [] } : null;
  }
  const spaced = /^\d{6}$/.test(raw) ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw;
  return {
    html: row(`<div class="sn-sk sn-ink" style="background:${ctx.p.sunken};border-radius:8px;padding:14px 0;text-align:center;font-family:${MONO};font-size:34px;font-weight:600;letter-spacing:0.22em;color:${ctx.p.ink}">${escapeHtml(spaced)}</div>`),
    text: [spaced],
  };
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function renderSignature(ctx: Ctx, block: Extract<EmailBlock, { type: "signature" }>): BlockOut | null {
  const name = inlineText(ctx, block.name).trim();
  if (!name) return null;
  const role = inlineText(ctx, block.role).trim();
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="38" valign="middle" style="width:38px;height:38px;border-radius:19px;background:${ctx.p.brandSoft};color:${ctx.p.brand};font-family:${SANS};font-size:13px;font-weight:600;text-align:center" class="sn-av">${escapeHtml(initials(name))}</td><td style="padding-left:10px;font-family:${SANS};font-size:14px;line-height:1.4"><strong class="sn-ink" style="display:block;font-weight:600;color:${ctx.p.ink}">${inlineHtml(ctx, block.name)}</strong><span class="sn-mu" style="font-size:13px;color:${ctx.p.muted}">${inlineHtml(ctx, block.role)}</span></td></tr></table>`;
  return { html: row(html), text: [name, ...(role ? [role] : [])] };
}

function renderBlock(ctx: Ctx, block: EmailBlock, first: boolean): BlockOut | null {
  if (!blockVisible(ctx, block)) return null;
  switch (block.type) {
    case "heading":
      return renderHeading(ctx, block.text, first);
    case "paragraph":
      if (isInlineEmpty(block.text)) return null;
      return { html: row(`<p ${paragraphStyle(ctx)}>${inlineHtml(ctx, block.text)}</p>`), text: [inlineText(ctx, block.text)] };
    case "details":
      return renderDetails(ctx, block);
    case "lineItems":
      return renderLineItems(ctx, block);
    case "button":
      return renderButton(ctx, block);
    case "callout":
      return renderCallout(ctx, block);
    case "photos":
      return renderPhotos(ctx, block);
    case "code":
      return renderCode(ctx, block);
    case "signature":
      return renderSignature(ctx, block);
    case "divider":
      return { html: row(`<div class="sn-ln-bg" style="height:1px;line-height:1px;font-size:1px;background:${ctx.p.line}">&nbsp;</div>`), text: ["----"] };
    case "note":
      if (isInlineEmpty(block.text)) return null;
      return { html: row(`<p ${paragraphStyle(ctx, 13, ctx.p.muted, "sn-mu")}>${inlineHtml(ctx, block.text)}</p>`), text: [inlineText(ctx, block.text)] };
  }
}

function wordmark(ctx: Ctx): string {
  const name = ctx.options.business.companyName || "sNeek Property Services";
  const [first, ...rest] = name.split(/\s+/);
  const small = rest.join(" ");
  const color = ctx.options.scheme === "dark" ? ctx.p.ink : ctx.p.brand;
  return `<div class="sn-lg" style="font-family:${SERIF};font-size:24px;line-height:1;color:${color}">${escapeHtml(first)}</div>${small ? `<div class="sn-mu" style="margin-top:3px;font-family:${SANS};font-size:10px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:${ctx.p.muted}">${escapeHtml(small)}</div>` : ""}`;
}

function logoHtml(ctx: Ctx): string {
  const { theme, business } = ctx.options;
  const light = safeHref(theme.logoUrl || business.logoUrl || "");
  const dark = safeHref(theme.logoDarkUrl || business.logoDarkUrl || "");
  const alt = escapeHtml(business.companyName || "sNeek");
  if (!light) return wordmark(ctx);
  const forcedDark = ctx.options.scheme === "dark";
  if (forcedDark) return `<img src="${escapeHtml(dark ?? light)}" width="120" alt="${alt}" style="display:block;width:120px;max-width:120px;height:auto;border:0">`;
  const lightImg = `<img src="${escapeHtml(light)}" width="120" alt="${alt}" class="sn-logo-l" style="display:block;width:120px;max-width:120px;height:auto;border:0">`;
  const darkImg = dark ? `<!--[if !mso]><!--><img src="${escapeHtml(dark)}" width="120" alt="${alt}" class="sn-logo-d" style="display:none;width:120px;max-width:120px;height:auto;border:0;mso-hide:all"><!--<![endif]-->` : "";
  return `${lightImg}${darkImg}`;
}

function headerRow(ctx: Ctx, reference: string): string {
  const ref = reference ? `<td align="right" valign="middle" class="sn-mu" style="font-family:${SANS};font-size:12px;color:${ctx.p.muted};white-space:nowrap">${escapeHtml(reference)}</td>` : "";
  return `<tr><td class="sn-px sn-ln" style="padding:20px ${PAD_X}px 14px;border-bottom:1px solid ${ctx.p.line}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${logoHtml(ctx)}</td>${ref}</tr></table></td></tr>`;
}

function footerParts(ctx: Ctx): { html: string; text: string[] } {
  const { business, theme, definition } = ctx.options;
  const lines: string[] = [];
  const text: string[] = ["--"];
  const nameLine = `<strong class="sn-tx" style="font-weight:600;color:${ctx.p.text}">${escapeHtml(business.companyName)}</strong>${business.abn ? ` · ABN ${escapeHtml(business.abn)}` : ""}`;
  lines.push(nameLine);
  text.push(business.companyName, ...(business.abn || business.phone ? [[business.abn ? `ABN ${business.abn}` : "", business.phone].filter(Boolean).join(" · ")] : []));
  const addressLine = [business.address, business.phone].filter(Boolean).map(escapeHtml).join(" · ");
  if (addressLine) lines.push(addressLine);
  if (business.address) text.push(business.address);
  if (theme.footerExtra) {
    lines.push(escapeHtml(theme.footerExtra));
    text.push(theme.footerExtra);
  }
  const why = definition.security ? "Security emails can't be turned off." : definition.whyLine;
  lines.push(escapeHtml(why));
  text.push(why);
  const linkStyle = `color:${ctx.p.brand};font-weight:600;text-decoration:underline`;
  const links: string[] = [];
  if (ctx.options.unsubscribeUrl) {
    links.push(`<a href="${escapeHtml(ctx.options.unsubscribeUrl)}" class="sn-br" style="${linkStyle}">Unsubscribe</a>`);
    text.push(`Unsubscribe: ${ctx.options.unsubscribeUrl}`);
  }
  if (!definition.security && ctx.options.preferencesUrl) {
    links.push(`<a href="${escapeHtml(ctx.options.preferencesUrl)}" class="sn-br" style="${linkStyle}">Email preferences</a>`);
    text.push(`Email preferences: ${ctx.options.preferencesUrl}`);
  }
  const contact = business.contactEmail && safeHref(`mailto:${business.contactEmail}`);
  if (contact) links.push(`<a href="${escapeHtml(contact)}" class="sn-br" style="${linkStyle}">Contact us</a>`);
  links.push("Sent to the address on your account");
  lines.push(links.join(" · "));
  const html = `<tr><td class="sn-px sn-sk sn-mu sn-ln" style="padding:16px ${PAD_X}px 20px;background:${ctx.p.sunken};border-top:1px solid ${ctx.p.line};border-radius:0 0 10px 10px;font-family:${SANS};font-size:12px;line-height:1.55;color:${ctx.p.muted}">${lines.map((line) => `<p style="margin:0 0 6px">${line}</p>`).join("")}</td></tr>`;
  return { html, text };
}

function darkCss(p: EmailPalette): string {
  const rules = [
    `.sn-bg{background:${p.page}!important}`,
    `.sn-card{background:${p.card}!important;border-color:${p.line}!important}`,
    `.sn-ink{color:${p.ink}!important}`,
    `.sn-tx{color:${p.text}!important}`,
    `.sn-mu{color:${p.muted}!important}`,
    `.sn-ln{border-color:${p.line}!important}`,
    `.sn-ln-bg{background:${p.line}!important}`,
    `.sn-sk{background:${p.sunken}!important}`,
    `.sn-br{color:${p.brand}!important}`,
    `.sn-lg{color:${p.ink}!important}`,
    `.sn-btn{background:${p.brand}!important;color:${p.brandText}!important}`,
    `.sn-av{background:${p.brandSoft}!important;color:${p.ink}!important}`,
    `.sn-logo-l{display:none!important}`,
    `.sn-logo-d{display:block!important}`,
    ...(["note", "action", "problem", "done"] as const).flatMap((tone) => [
      `.sn-cl-${tone}{background:${p.callout[tone].bg}!important}`,
      `.sn-cl-${tone}-t{color:${p.callout[tone].fg}!important}`,
      `.sn-cl-${tone}-i{background:${p.callout[tone].fg}!important;color:${p.callout[tone].bg}!important}`,
    ]),
  ];
  return rules.join("");
}

function headHtml(subject: string, dark: EmailPalette, scheme: RenderScheme): string {
  const media = scheme === "auto" ? `@media (prefers-color-scheme: dark){${darkCss(dark)}}[data-ogsc] .sn-bg{background:${dark.page}!important}${darkCss(dark).split("}").filter(Boolean).map((rule) => `[data-ogsc] ${rule}}`).join("")}` : "";
  return `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="${scheme === "auto" ? "light dark" : scheme}"><meta name="supported-color-schemes" content="${scheme === "auto" ? "light dark" : scheme}"><title>${escapeHtml(subject)}</title><!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]--><style>body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%}table{border-collapse:collapse}img{-ms-interpolation-mode:bicubic}a{color:inherit}@media only screen and (max-width:480px){.sn-card{width:100%!important}.sn-px{padding-left:18px!important;padding-right:18px!important}.sn-h1{font-size:22px!important}.sn-dl-l,.sn-dl-v{display:block!important;width:auto!important}.sn-dl-l{padding:8px 14px 0 14px!important;font-size:12.5px!important}.sn-dl-v{padding:0 14px 8px 14px!important;border-top:0!important}.sn-btn-a{display:block!important;text-align:center!important}}${media}</style></head>`;
}

/** The base layout around already-rendered body rows (also used by the legacy wrapper). */
export function renderLayout(input: { options: RenderOptions; subject: string; preheader: string; reference: string; bodyRows: string; footer?: { html: string } }): string {
  const scheme = input.options.scheme ?? "auto";
  const light = lightPalette(input.options.theme);
  const dark = darkPalette(input.options.theme);
  const p = scheme === "dark" ? dark : light;
  const ctx: Ctx = { options: input.options, values: {}, vars: new Map(), p, missing: new Map() };
  const footer = input.footer ?? footerParts(ctx);
  const preheader = input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${p.page}">${escapeHtml(input.preheader)}${"&#8199;&#847;".repeat(40)}</div>` : "";
  return `<!doctype html><html lang="en-AU" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">${headHtml(input.subject, dark, scheme)}<body class="sn-bg" style="margin:0;padding:0;background:${p.page}">${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.page}" class="sn-bg" style="background:${p.page}"><tr><td align="center" style="padding:22px 10px"><table role="presentation" class="sn-card sn-ln" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${p.card};border:1px solid ${p.line};border-radius:10px">${headerRow(ctx, input.reference)}${input.bodyRows}${footer.html}</table></td></tr></table></body></html>`;
}

function wrapText(line: string, width = 72): string[] {
  if (line.length <= width || /^https?:\/\//.test(line)) return [line];
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width && current) {
      out.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) out.push(current);
  return out;
}

type BodyOut = { ctx: Ctx; rows: string; textBlocks: string[]; reference: string };

function renderBody(doc: EmailDocument, values: Record<string, string>, options: RenderOptions): BodyOut {
  const scheme = options.scheme ?? "auto";
  const p = scheme === "dark" ? darkPalette(options.theme) : lightPalette(options.theme);
  const ctx: Ctx = { options, values, vars: new Map(options.definition.variables.map((variable) => [variable.name, variable])), p, missing: new Map() };
  const reference = doc.reference && present(ctx, doc.reference) ? rawValue(ctx, doc.reference) : "";
  const rows: string[] = [];
  const textBlocks: string[] = [];
  let first = true;
  for (const block of doc.blocks) {
    const out = renderBlock(ctx, block, first && block.type === "heading");
    if (block.type === "heading" && out) first = false;
    if (!out) continue;
    rows.push(out.html);
    if (out.text.length) textBlocks.push(out.text.flatMap((line) => wrapText(line)).join("\n"));
  }
  return { ctx, rows: rows.join(""), textBlocks, reference };
}

/** Body rows only (no layout): used to add a block, such as a button, under an HTML body. */
export function renderBodyRows(doc: EmailDocument, values: Record<string, string>, options: RenderOptions): { rows: string; text: string[] } {
  const body = renderBody(doc, values, options);
  return { rows: body.rows, text: body.textBlocks };
}

/** Render one email document with its values. */
export function renderEmailDocument(doc: EmailDocument, values: Record<string, string>, options: RenderOptions): RenderedEmail {
  const { ctx, rows, textBlocks, reference } = renderBody(doc, values, options);
  const subject = inlineText(ctx, doc.subject).replace(/\s+/g, " ").trim();
  const preheader = inlineText(ctx, doc.preheader).replace(/\s+/g, " ").trim();
  // Every required value counts, even one an earlier block did not reach.
  for (const variable of options.definition.variables) {
    if (variable.required && !present(ctx, variable.name)) ctx.missing.set(variable.name, variable.label);
  }
  const footer = footerParts(ctx);
  const html = renderLayout({ options, subject, preheader, reference, bodyRows: rows, footer });
  const header = [options.business.companyName, reference].filter(Boolean).join(" · ");
  const text = [header, "", textBlocks.join("\n\n"), "", footer.text.join("\n")].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { subject, preheader, html, text, missing: Array.from(ctx.missing.values()), missingNames: Array.from(ctx.missing.keys()) };
}
