/**
 * renderDocumentHtml — TemplateDoc → semantic A4 HTML with print CSS
 * (rebrand doc 03 §1.1). Feeds the EXISTING lib/reports/pdf.ts
 * renderPdfFromHtml() (Playwright) — we do not replace the PDF engine.
 * The same HTML serves the web channel (portal viewing / live preview)
 * until the editor phase lifts blocks into per-block React components.
 */

import { brandCssVars, resolveTokenRef, type BrandTokens } from "@/lib/brand/tokens";
import type { Channel, TemplateDoc } from "../model";
import { renderBlocks, type RenderOptions } from "./engine";

export function renderDocumentHtml(
  doc: TemplateDoc,
  data: unknown,
  brand: BrandTokens,
  channel: Extract<Channel, "pdf" | "web"> = "pdf",
  opts: RenderOptions = {},
): string {
  const accent = doc.theme.accent ? resolveTokenRef(brand, doc.theme.accent) : brand.color.accent;
  const vars = Object.entries(brandCssVars(brand))
    .map(([key, value]) => `${key}: ${value};`)
    .join(" ");
  const body = renderBlocks(doc, channel, "renderDocument", data, brand, opts);
  const margin = doc.page.margin || "18mm 16mm";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { ${vars} --tpl-accent: ${accent}; }
  @page { size: A4; margin: ${margin}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--tpl-font-body); color: var(--tpl-color-ink); font-size: 12px; line-height: 1.55; }

  .tpl-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 2px solid var(--tpl-accent); margin-bottom: 18px; }
  .tpl-logo { height: 40px; }
  .tpl-wordmark { font-family: var(--tpl-font-display); font-size: 20px; color: var(--tpl-color-primary); }
  .tpl-identity { margin: 6px 0 0; font-size: 10px; color: var(--tpl-color-muted); }
  .tpl-header-right { text-align: right; }
  .tpl-doc-number { margin: 2px 0 0; font-family: var(--tpl-font-display); font-size: 16px; }
  .tpl-doc-date { margin: 2px 0 0; font-size: 10px; color: var(--tpl-color-muted); }

  .tpl-eyebrow { margin: 0; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: var(--tpl-accent); font-weight: 600; }
  .tpl-hero { margin: 0 0 16px; }
  .tpl-hero h1 { margin: 2px 0 0; font-family: var(--tpl-font-display); font-weight: 600; font-size: 24px; line-height: 1.25; }
  .tpl-gold-rule { width: 48px; height: 2px; background: var(--tpl-accent); margin-top: 10px; }
  .tpl-subline { margin: 8px 0 0; color: var(--tpl-color-muted); }

  .tpl-heading { font-family: var(--tpl-font-display); font-weight: 600; margin: 18px 0 6px; }
  .tpl-heading-1 { font-size: 20px; } .tpl-heading-2 { font-size: 16px; } .tpl-heading-3 { font-size: 13px; }
  .tpl-text { margin: 0 0 8px; }
  .tpl-empty { color: var(--tpl-color-muted); }

  .tpl-stat-row { display: flex; gap: 10px; margin: 12px 0; }
  .tpl-stat { flex: 1; border: 1px solid var(--tpl-color-rule); border-radius: 8px; padding: 10px 12px; break-inside: avoid; }
  .tpl-stat-label { margin: 0; font-size: 8px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--tpl-color-muted); }
  .tpl-stat-value { margin: 3px 0 0; font-family: var(--tpl-font-display); font-size: 18px; }
  .tpl-stat-delta { margin: 2px 0 0; font-size: 9px; color: var(--tpl-color-muted); }

  .tpl-info-card { background: #FAF8F3; border: 1px solid var(--tpl-color-rule); border-radius: 8px; padding: 12px 14px; margin: 10px 0; break-inside: avoid; }
  .tpl-card-title { margin: 0 0 6px; font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--tpl-accent); font-weight: 600; }
  .tpl-kv { width: 100%; border-collapse: collapse; }
  .tpl-kv-label { padding: 3px 0; color: var(--tpl-color-muted); width: 38%; vertical-align: top; }
  .tpl-kv-value { padding: 3px 0; font-weight: 600; }

  .tpl-line-items { width: 100%; border-collapse: collapse; margin: 10px 0; }
  .tpl-line-items thead { display: table-header-group; } /* repeat per page */
  .tpl-th { padding: 6px 8px; font-size: 8px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--tpl-color-muted); border-bottom: 1.5px solid var(--tpl-color-rule); text-align: left; }
  .tpl-td { padding: 6px 8px; border-bottom: 1px solid var(--tpl-color-rule); }
  .tpl-line-items tr { break-inside: avoid; }
  .tpl-align-right { text-align: right; } .tpl-align-center { text-align: center; } .tpl-align-left { text-align: left; }

  .tpl-totals { display: flex; justify-content: flex-end; margin: 12px 0; break-inside: avoid; }
  .tpl-totals table { border-collapse: collapse; min-width: 45%; }
  .tpl-totals td { padding: 4px 0 4px 24px; }
  .tpl-total-emphasis td { border-top: 2px solid var(--tpl-accent); font-family: var(--tpl-font-display); font-size: 15px; font-weight: 700; padding-top: 7px; }

  .tpl-callout { border-radius: 8px; padding: 10px 14px; margin: 10px 0; break-inside: avoid; }
  .tpl-callout p { margin: 0; }
  .tpl-callout-title { font-weight: 700; margin: 0 0 3px; }
  .tpl-callout-info { background: #EEF3F1; color: #1E4A3B; }
  .tpl-callout-success { background: #EAF3EE; color: #2E7D5B; }
  .tpl-callout-warning { background: #F7EFE0; color: #A8742C; }
  .tpl-callout-urgent { background: #F6E9E8; color: #8C3A38; }

  .tpl-terms { margin-top: 16px; font-size: 9px; color: var(--tpl-color-muted); }
  .tpl-button { display: inline-block; background: var(--tpl-color-primary); color: #fff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; }
  .tpl-pdf-url { color: var(--tpl-color-muted); font-size: 10px; }
  .tpl-image { max-width: 100%; border-radius: 6px; }
  .tpl-divider { border: 0; border-top: 1px solid var(--tpl-color-rule); margin: 12px 0; }
  .tpl-page-break { break-after: page; page-break-after: always; }
  .tpl-footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid var(--tpl-color-rule); font-size: 9px; color: var(--tpl-color-muted); }
  .tpl-footer p { margin: 0 0 2px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}
