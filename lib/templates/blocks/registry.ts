/**
 * Block registry — Phase-1 block set (rebrand doc 03 §1.3).
 * One file for now; splits into per-block folders when the editor phase adds
 * per-block React canvas components. Registry-driven: renderers walk this map,
 * so adding a block here requires no renderer/editor changes.
 *
 * Deferred to the documents wave: richText, photoGrid, checklistSection,
 * qaScoreCard, signature, columns.
 */

import { z } from "zod";
import { getPath } from "../model";
import { applyFormatter } from "../formatters";
import { getCtxTimezone, type BlockDefinition, type BlockRenderCtx } from "./types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Email-safe wrapper row: one full-width td with padding. */
function emailRow(inner: string, pad = "12px 32px"): string {
  return `<tr><td style="padding:${pad};">${inner}</td></tr>`;
}

const TONE_COLORS: Record<string, { bg: string; ink: string }> = {
  info: { bg: "#EEF3F1", ink: "#1E4A3B" },
  success: { bg: "#EAF3EE", ink: "#2E7D5B" },
  warning: { bg: "#F7EFE0", ink: "#A8742C" },
  urgent: { bg: "#F6E9E8", ink: "#8C3A38" },
};

// ---------------------------------------------------------------------------
// header
// ---------------------------------------------------------------------------

const headerProps = z.object({
  variant: z.enum(["email", "document"]).default("email"),
  eyebrow: z.string().default(""), // e.g. "TAX INVOICE"
  docNumber: z.string().default(""),
  docDate: z.string().default(""),
  showLogo: z.boolean().default(true),
});

const header: BlockDefinition<z.infer<typeof headerProps>> = {
  type: "header",
  label: "Header",
  channels: ["email", "pdf", "web"],
  propsSchema: headerProps,
  defaults: () => headerProps.parse({}),
  renderEmail(props, ctx) {
    const logo =
      props.showLogo && ctx.brand.logo.url
        ? `<img src="${esc(ctx.brand.logo.url)}" alt="${esc(ctx.brand.identity.companyName)}" height="36" style="height:36px;border:0;display:block;" />`
        : `<span style="font-family:${ctx.brand.font.display};font-size:20px;color:${ctx.brand.color.primary};">${esc(ctx.brand.identity.companyName)}</span>`;
    return emailRow(logo, "24px 32px 8px");
  },
  renderDocument(props, ctx) {
    const logoUrl = ctx.brand.logo.documentUrl || ctx.brand.logo.url;
    const logo =
      props.showLogo && logoUrl
        ? `<img class="tpl-logo" src="${esc(logoUrl)}" alt="${esc(ctx.brand.identity.companyName)}" />`
        : `<span class="tpl-wordmark">${esc(ctx.brand.identity.companyName)}</span>`;
    const identity = [ctx.brand.identity.address, ctx.brand.identity.abn ? `ABN ${ctx.brand.identity.abn}` : ""]
      .filter(Boolean)
      .map(esc)
      .join(" · ");
    const right =
      props.eyebrow || props.docNumber
        ? `<div class="tpl-header-right"><p class="tpl-eyebrow">${ctx.merge(props.eyebrow)}</p><p class="tpl-doc-number">${ctx.merge(props.docNumber)}</p><p class="tpl-doc-date">${ctx.merge(props.docDate)}</p></div>`
        : "";
    return `<header class="tpl-header"><div class="tpl-header-left">${logo}<p class="tpl-identity">${identity}</p></div>${right}</header>`;
  },
};

// ---------------------------------------------------------------------------
// hero
// ---------------------------------------------------------------------------

const heroProps = z.object({
  eyebrow: z.string().default(""),
  headline: z.string().default("Headline"),
  subline: z.string().default(""),
});

const hero: BlockDefinition<z.infer<typeof heroProps>> = {
  type: "hero",
  label: "Hero",
  channels: ["email", "pdf", "web"],
  propsSchema: heroProps,
  defaults: () => heroProps.parse({}),
  renderEmail(props, ctx) {
    const eyebrow = props.eyebrow
      ? `<p style="margin:0 0 6px;font-family:${ctx.brand.font.body};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${ctx.brand.color.accent};">${ctx.merge(props.eyebrow)}</p>`
      : "";
    const subline = props.subline
      ? `<p style="margin:10px 0 0;font-family:${ctx.brand.font.body};font-size:15px;line-height:1.6;color:${ctx.brand.color.muted};">${ctx.merge(props.subline)}</p>`
      : "";
    return emailRow(
      `${eyebrow}<h1 style="margin:0;font-family:${ctx.brand.font.display};font-weight:600;font-size:26px;line-height:1.3;color:${ctx.brand.color.ink};">${ctx.merge(props.headline)}</h1><div style="width:48px;height:2px;background:${ctx.brand.color.accent};margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>${subline}`,
      "20px 32px",
    );
  },
  renderDocument(props, ctx) {
    const eyebrow = props.eyebrow ? `<p class="tpl-eyebrow">${ctx.merge(props.eyebrow)}</p>` : "";
    const subline = props.subline ? `<p class="tpl-subline">${ctx.merge(props.subline)}</p>` : "";
    return `<section class="tpl-hero">${eyebrow}<h1>${ctx.merge(props.headline)}</h1><div class="tpl-gold-rule"></div>${subline}</section>`;
  },
};

// ---------------------------------------------------------------------------
// heading / text / terms
// ---------------------------------------------------------------------------

const headingProps = z.object({
  text: z.string().default("Heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
});

const heading: BlockDefinition<z.infer<typeof headingProps>> = {
  type: "heading",
  label: "Heading",
  channels: ["email", "pdf", "web"],
  propsSchema: headingProps,
  defaults: () => headingProps.parse({}),
  renderEmail(props, ctx) {
    const size = props.level === 1 ? 24 : props.level === 2 ? 19 : 16;
    return emailRow(
      `<h${props.level} style="margin:0;font-family:${ctx.brand.font.display};font-weight:600;font-size:${size}px;color:${ctx.brand.color.ink};">${ctx.merge(props.text)}</h${props.level}>`,
    );
  },
  renderDocument(props, ctx) {
    return `<h${props.level} class="tpl-heading tpl-heading-${props.level}">${ctx.merge(props.text)}</h${props.level}>`;
  },
};

const textProps = z.object({ text: z.string().default("Paragraph text.") });

const text: BlockDefinition<z.infer<typeof textProps>> = {
  type: "text",
  label: "Text",
  channels: ["email", "pdf", "web", "sms"],
  propsSchema: textProps,
  defaults: () => textProps.parse({}),
  renderEmail(props, ctx) {
    return emailRow(
      `<p style="margin:0;font-family:${ctx.brand.font.body};font-size:15px;line-height:1.65;color:${ctx.style.color ? ctx.color(ctx.style.color, ctx.brand.color.ink) : ctx.brand.color.ink};">${ctx.merge(props.text)}</p>`,
    );
  },
  renderDocument(props, ctx) {
    return `<p class="tpl-text">${ctx.merge(props.text)}</p>`;
  },
  renderText(props, ctx) {
    return ctx.mergeText(props.text);
  },
};

const termsProps = z.object({ text: z.string().default("") });

const terms: BlockDefinition<z.infer<typeof termsProps>> = {
  type: "terms",
  label: "Terms",
  channels: ["pdf", "web"],
  propsSchema: termsProps,
  defaults: () => termsProps.parse({}),
  renderDocument(props, ctx) {
    return `<section class="tpl-terms">${ctx.merge(props.text)}</section>`;
  },
};

// ---------------------------------------------------------------------------
// statRow / infoCard
// ---------------------------------------------------------------------------

const statRowProps = z.object({
  items: z
    .array(z.object({ label: z.string(), value: z.string(), delta: z.string().default("") }))
    .min(1)
    .max(4)
    .default([{ label: "Stat", value: "{{value}}", delta: "" }]),
});

const statRow: BlockDefinition<z.infer<typeof statRowProps>> = {
  type: "statRow",
  label: "Stat row",
  channels: ["email", "pdf", "web"],
  propsSchema: statRowProps,
  defaults: () => statRowProps.parse({}),
  renderEmail(props, ctx) {
    const width = Math.floor(100 / props.items.length);
    const cells = props.items
      .map(
        (item) =>
          `<td width="${width}%" style="padding:12px;border:1px solid ${ctx.brand.color.rule};border-radius:8px;"><p style="margin:0;font-family:${ctx.brand.font.body};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${ctx.brand.color.muted};">${ctx.merge(item.label)}</p><p style="margin:4px 0 0;font-family:${ctx.brand.font.display};font-size:22px;color:${ctx.brand.color.ink};">${ctx.merge(item.value)}</p>${item.delta ? `<p style="margin:2px 0 0;font-family:${ctx.brand.font.body};font-size:12px;color:${ctx.brand.color.muted};">${ctx.merge(item.delta)}</p>` : ""}</td>`,
      )
      .join(`<td width="8" style="font-size:0;">&nbsp;</td>`);
    return emailRow(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`,
    );
  },
  renderDocument(props, ctx) {
    const cells = props.items
      .map(
        (item) =>
          `<div class="tpl-stat"><p class="tpl-stat-label">${ctx.merge(item.label)}</p><p class="tpl-stat-value">${ctx.merge(item.value)}</p>${item.delta ? `<p class="tpl-stat-delta">${ctx.merge(item.delta)}</p>` : ""}</div>`,
      )
      .join("");
    return `<section class="tpl-stat-row">${cells}</section>`;
  },
};

const infoCardProps = z.object({
  title: z.string().default(""),
  rows: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .default([{ label: "Label", value: "{{value}}" }]),
});

const infoCard: BlockDefinition<z.infer<typeof infoCardProps>> = {
  type: "infoCard",
  label: "Info card",
  channels: ["email", "pdf", "web"],
  propsSchema: infoCardProps,
  defaults: () => infoCardProps.parse({}),
  renderEmail(props, ctx) {
    const title = props.title
      ? `<p style="margin:0 0 8px;font-family:${ctx.brand.font.body};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${ctx.brand.color.accent};">${ctx.merge(props.title)}</p>`
      : "";
    const rows = props.rows
      .map(
        (row) =>
          `<tr><td style="padding:5px 0;font-family:${ctx.brand.font.body};font-size:13px;color:${ctx.brand.color.muted};width:40%;">${ctx.merge(row.label)}</td><td style="padding:5px 0;font-family:${ctx.brand.font.body};font-size:13px;color:${ctx.brand.color.ink};font-weight:600;">${ctx.merge(row.value)}</td></tr>`,
      )
      .join("");
    return emailRow(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F3;border:1px solid ${ctx.brand.color.rule};border-radius:10px;"><tr><td style="padding:16px 20px;">${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`,
    );
  },
  renderDocument(props, ctx) {
    const title = props.title ? `<p class="tpl-card-title">${ctx.merge(props.title)}</p>` : "";
    const rows = props.rows
      .map((row) => `<tr><td class="tpl-kv-label">${ctx.merge(row.label)}</td><td class="tpl-kv-value">${ctx.merge(row.value)}</td></tr>`)
      .join("");
    return `<section class="tpl-info-card">${title}<table class="tpl-kv">${rows}</table></section>`;
  },
};

// ---------------------------------------------------------------------------
// lineItems / totals
// ---------------------------------------------------------------------------

const lineItemsProps = z.object({
  /** Data path of the array to bind, e.g. "invoice.lines". */
  bind: z.string().default(""),
  columns: z
    .array(
      z.object({
        label: z.string(),
        path: z.string(),
        format: z.enum(["text", "money", "date", "number"]).default("text"),
        align: z.enum(["left", "right", "center"]).default("left"),
      }),
    )
    .default([]),
  emptyText: z.string().default("No items."),
});

function formatCell(
  raw: unknown,
  format: "text" | "money" | "date" | "number",
  ctx: BlockRenderCtx,
): string {
  if (format === "text") {
    if (raw == null) return "";
    return typeof raw === "string" ? raw : String(raw as string | number | boolean);
  }
  return applyFormatter(format, raw, undefined, { timezone: getCtxTimezone(ctx) });
}

const lineItems: BlockDefinition<z.infer<typeof lineItemsProps>> = {
  type: "lineItems",
  label: "Line items",
  channels: ["email", "pdf", "web"],
  propsSchema: lineItemsProps,
  defaults: () => lineItemsProps.parse({}),
  renderEmail(props, ctx) {
    return emailRow(lineItemsTable(props, ctx, "email"));
  },
  renderDocument(props, ctx) {
    return lineItemsTable(props, ctx, "document");
  },
};

function lineItemsTable(
  props: z.infer<typeof lineItemsProps>,
  ctx: BlockRenderCtx,
  mode: "email" | "document",
): string {
  const rowsData = getPath(ctx.data, props.bind);
  const items = Array.isArray(rowsData) ? rowsData : [];
  if (items.length === 0) {
    return mode === "email"
      ? `<p style="margin:0;font-family:${ctx.brand.font.body};font-size:13px;color:${ctx.brand.color.muted};">${esc(props.emptyText)}</p>`
      : `<p class="tpl-empty">${esc(props.emptyText)}</p>`;
  }
  const th = props.columns
    .map((col) =>
      mode === "email"
        ? `<th align="${col.align}" style="padding:8px 10px;font-family:${ctx.brand.font.body};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${ctx.brand.color.muted};border-bottom:1px solid ${ctx.brand.color.rule};text-align:${col.align};">${esc(col.label)}</th>`
        : `<th class="tpl-th tpl-align-${col.align}">${esc(col.label)}</th>`,
    )
    .join("");
  const trs = items
    .map((item) => {
      const tds = props.columns
        .map((col) => {
          const cell = esc(formatCell(getPath(item, col.path), col.format, ctx));
          return mode === "email"
            ? `<td align="${col.align}" style="padding:8px 10px;font-family:${ctx.brand.font.body};font-size:13px;color:${ctx.brand.color.ink};border-bottom:1px solid ${ctx.brand.color.rule};text-align:${col.align};">${cell}</td>`
            : `<td class="tpl-td tpl-align-${col.align}">${cell}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return mode === "email"
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${th}</tr>${trs}</table>`
    : `<table class="tpl-line-items"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

const totalsProps = z.object({
  rows: z
    .array(
      z.object({
        label: z.string(),
        /** Merge template for the amount — binds computed totals, NEVER recomputes money. */
        value: z.string(),
        emphasis: z.boolean().default(false),
        when: z.string().default(""),
      }),
    )
    .default([]),
});

const totals: BlockDefinition<z.infer<typeof totalsProps>> = {
  type: "totals",
  label: "Totals",
  channels: ["email", "pdf", "web"],
  propsSchema: totalsProps,
  defaults: () => totalsProps.parse({}),
  renderEmail(props, ctx) {
    const rows = visibleTotalRows(props, ctx)
      .map((row) => {
        const weight = row.emphasis ? 700 : 400;
        const size = row.emphasis ? 17 : 13;
        const border = row.emphasis ? `border-top:2px solid ${ctx.brand.color.accent};` : "";
        return `<tr><td style="padding:6px 0;${border}font-family:${ctx.brand.font.body};font-size:${size}px;font-weight:${weight};color:${ctx.brand.color.ink};">${ctx.merge(row.label)}</td><td align="right" style="padding:6px 0;${border}font-family:${row.emphasis ? ctx.brand.font.display : ctx.brand.font.body};font-size:${size}px;font-weight:${weight};color:${ctx.brand.color.ink};text-align:right;">${ctx.merge(row.value)}</td></tr>`;
      })
      .join("");
    return emailRow(
      `<table role="presentation" width="60%" align="right" cellpadding="0" cellspacing="0" style="margin-left:auto;">${rows}</table>`,
    );
  },
  renderDocument(props, ctx) {
    const rows = visibleTotalRows(props, ctx)
      .map(
        (row) =>
          `<tr class="${row.emphasis ? "tpl-total-emphasis" : ""}"><td>${ctx.merge(row.label)}</td><td class="tpl-align-right">${ctx.merge(row.value)}</td></tr>`,
      )
      .join("");
    return `<section class="tpl-totals"><table>${rows}</table></section>`;
  },
};

function visibleTotalRows(props: z.infer<typeof totalsProps>, ctx: BlockRenderCtx) {
  return props.rows.filter((row) => {
    if (!row.when) return true;
    const negated = row.when.startsWith("!");
    const path = negated ? row.when.slice(1) : row.when;
    const value = getPath(ctx.data, path);
    const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
    return negated ? !truthy : truthy;
  });
}

// ---------------------------------------------------------------------------
// button / callout / image / divider / spacer / pageBreak / footer / textBlock
// ---------------------------------------------------------------------------

const buttonProps = z.object({
  text: z.string().default("View details"),
  href: z.string().default("{{actionUrl}}"),
  showUrlInPdf: z.boolean().default(false),
});

const button: BlockDefinition<z.infer<typeof buttonProps>> = {
  type: "button",
  label: "Button",
  channels: ["email", "web", "pdf"],
  propsSchema: buttonProps,
  defaults: () => buttonProps.parse({}),
  renderEmail(props, ctx) {
    const href = esc(ctx.mergeText(props.href));
    // Bulletproof-ish button: table cell with bg color + padded link.
    return emailRow(
      `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${ctx.brand.color.primary};border-radius:8px;"><a href="${href}" style="display:inline-block;padding:12px 28px;font-family:${ctx.brand.font.body};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${ctx.merge(props.text)}</a></td></tr></table>`,
      "16px 32px",
    );
  },
  renderDocument(props, ctx) {
    if (ctx.channel === "pdf" && !props.showUrlInPdf) return "";
    const href = esc(ctx.mergeText(props.href));
    return ctx.channel === "pdf"
      ? `<p class="tpl-text tpl-pdf-url">${ctx.merge(props.text)}: ${href}</p>`
      : `<a class="tpl-button" href="${href}">${ctx.merge(props.text)}</a>`;
  },
};

const calloutProps = z.object({
  tone: z.enum(["info", "success", "warning", "urgent"]).default("info"),
  title: z.string().default(""),
  text: z.string().default(""),
});

const callout: BlockDefinition<z.infer<typeof calloutProps>> = {
  type: "callout",
  label: "Callout",
  channels: ["email", "pdf", "web"],
  propsSchema: calloutProps,
  defaults: () => calloutProps.parse({}),
  renderEmail(props, ctx) {
    const tone = TONE_COLORS[props.tone];
    const title = props.title
      ? `<p style="margin:0 0 4px;font-family:${ctx.brand.font.body};font-size:13px;font-weight:700;color:${tone.ink};">${ctx.merge(props.title)}</p>`
      : "";
    return emailRow(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tone.bg};border-radius:10px;"><tr><td style="padding:14px 18px;">${title}<p style="margin:0;font-family:${ctx.brand.font.body};font-size:13px;line-height:1.55;color:${tone.ink};">${ctx.merge(props.text)}</p></td></tr></table>`,
    );
  },
  renderDocument(props, ctx) {
    const title = props.title ? `<p class="tpl-callout-title">${ctx.merge(props.title)}</p>` : "";
    return `<section class="tpl-callout tpl-callout-${props.tone}">${title}<p>${ctx.merge(props.text)}</p></section>`;
  },
};

const imageProps = z.object({
  src: z.string().default(""),
  alt: z.string().default(""),
  width: z.number().int().min(24).max(600).default(240),
});

const image: BlockDefinition<z.infer<typeof imageProps>> = {
  type: "image",
  label: "Image",
  channels: ["email", "pdf", "web"],
  propsSchema: imageProps,
  defaults: () => imageProps.parse({}),
  renderEmail(props, ctx) {
    if (!props.src) return "";
    const align = ctx.style.align ?? "center";
    return emailRow(
      `<img src="${esc(ctx.mergeText(props.src))}" alt="${esc(props.alt)}" width="${props.width}" style="display:block;max-width:100%;border:0;margin:${align === "center" ? "0 auto" : "0"};" />`,
    );
  },
  renderDocument(props, ctx) {
    if (!props.src) return "";
    return `<img class="tpl-image" src="${esc(ctx.mergeText(props.src))}" alt="${esc(props.alt)}" style="width:${props.width}px;" />`;
  },
};

const dividerProps = z.object({});
const divider: BlockDefinition<z.infer<typeof dividerProps>> = {
  type: "divider",
  label: "Divider",
  channels: ["email", "pdf", "web"],
  propsSchema: dividerProps,
  defaults: () => ({}),
  renderEmail(_props, ctx) {
    return emailRow(`<div style="height:1px;background:${ctx.brand.color.rule};font-size:0;line-height:0;">&nbsp;</div>`, "8px 32px");
  },
  renderDocument() {
    return `<hr class="tpl-divider" />`;
  },
};

const spacerProps = z.object({ height: z.number().int().min(4).max(120).default(24) });
const spacer: BlockDefinition<z.infer<typeof spacerProps>> = {
  type: "spacer",
  label: "Spacer",
  channels: ["email", "pdf", "web"],
  propsSchema: spacerProps,
  defaults: () => spacerProps.parse({}),
  renderEmail(props) {
    return `<tr><td style="height:${props.height}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  },
  renderDocument(props) {
    return `<div style="height:${props.height}px;"></div>`;
  },
};

const pageBreakProps = z.object({});
const pageBreak: BlockDefinition<z.infer<typeof pageBreakProps>> = {
  type: "pageBreak",
  label: "Page break",
  channels: ["pdf"],
  propsSchema: pageBreakProps,
  defaults: () => ({}),
  renderDocument(_props, ctx) {
    return ctx.channel === "pdf" ? `<div class="tpl-page-break"></div>` : "";
  },
};

const footerProps = z.object({
  note: z.string().default(""),
  showIdentity: z.boolean().default(true),
  showPageNumbers: z.boolean().default(false),
});

const footer: BlockDefinition<z.infer<typeof footerProps>> = {
  type: "footer",
  label: "Footer",
  channels: ["email", "pdf", "web"],
  propsSchema: footerProps,
  defaults: () => footerProps.parse({}),
  renderEmail(props, ctx) {
    const id = ctx.brand.identity;
    const identity = props.showIdentity
      ? `<p style="margin:0;font-family:${ctx.brand.font.body};font-size:12px;color:${ctx.brand.color.muted};">${esc(id.companyName)}${id.abn ? ` · ABN ${esc(id.abn)}` : ""}${id.accountsEmail ? ` · ${esc(id.accountsEmail)}` : ""}</p>`
      : "";
    const note = props.note
      ? `<p style="margin:6px 0 0;font-family:${ctx.brand.font.body};font-size:12px;color:${ctx.brand.color.muted};">${ctx.merge(props.note)}</p>`
      : "";
    return emailRow(
      `<div style="border-top:1px solid ${ctx.brand.color.rule};padding-top:16px;">${identity}${note}</div>`,
      "20px 32px 28px",
    );
  },
  renderDocument(props, ctx) {
    const id = ctx.brand.identity;
    const identity = props.showIdentity
      ? `<p>${esc(id.companyName)}${id.abn ? ` · ABN ${esc(id.abn)}` : ""}${id.address ? ` · ${esc(id.address)}` : ""}${id.accountsEmail ? ` · ${esc(id.accountsEmail)}` : ""}</p>`
      : "";
    const note = props.note ? `<p>${ctx.merge(props.note)}</p>` : "";
    return `<footer class="tpl-footer">${identity}${note}</footer>`;
  },
};

const textBlockProps = z.object({ text: z.string().default("") });
const textBlock: BlockDefinition<z.infer<typeof textBlockProps>> = {
  type: "textBlock",
  label: "SMS text",
  channels: ["sms"],
  propsSchema: textBlockProps,
  defaults: () => textBlockProps.parse({}),
  renderText(props, ctx) {
    return ctx.mergeText(props.text);
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export const BLOCK_REGISTRY: Record<string, BlockDefinition<any>> = {
  header,
  hero,
  heading,
  text,
  statRow,
  infoCard,
  lineItems,
  totals,
  terms,
  button,
  callout,
  image,
  divider,
  spacer,
  pageBreak,
  footer,
  textBlock,
};
/* eslint-enable @typescript-eslint/no-explicit-any */
