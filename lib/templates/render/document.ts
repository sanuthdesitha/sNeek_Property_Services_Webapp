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

  /* Report-wave blocks (checklistSection / photoGrid / qaScoreCard) */
  .tpl-checklist { margin: 10px 0; }
  .tpl-checklist-section { margin: 0 0 12px; break-inside: avoid; }
  .tpl-checklist-title { margin: 0 0 5px; font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--tpl-accent); font-weight: 600; }
  .tpl-checklist-item { display: flex; align-items: baseline; gap: 6px; padding: 3px 0; flex-wrap: wrap; }
  .tpl-check { flex: 0 0 auto; width: 14px; font-weight: 700; text-align: center; }
  .tpl-check-pass { color: var(--tpl-color-success); }
  .tpl-check-fail { color: var(--tpl-color-danger); }
  .tpl-check-na { color: var(--tpl-color-muted); }
  .tpl-item-label { flex: 1 1 auto; }
  .tpl-item-value { color: var(--tpl-color-muted); }
  .tpl-item-note { flex: 1 1 100%; margin: 2px 0 0 20px; font-size: 10px; color: var(--tpl-color-muted); }
  .tpl-item-excluded { opacity: 0.5; }
  .tpl-item-media { flex: 1 1 100%; display: flex; gap: 6px; margin: 4px 0 0 20px; flex-wrap: wrap; }
  .tpl-item-thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 4px; border: 1px solid var(--tpl-color-rule); }
  .tpl-item-video { display: inline-flex; align-items: center; justify-content: center; font-size: 9px; color: var(--tpl-color-muted); background: var(--tpl-color-surface); }

  .tpl-photo-grid { display: grid; gap: 8px; margin: 10px 0; break-inside: avoid; }
  .tpl-photo-grid[data-cols="2"] { grid-template-columns: repeat(2, 1fr); }
  .tpl-photo-grid[data-cols="3"] { grid-template-columns: repeat(3, 1fr); }
  .tpl-photo-grid[data-cols="4"] { grid-template-columns: repeat(4, 1fr); }
  .tpl-photo { position: relative; margin: 0; break-inside: avoid; }
  .tpl-photo-img { width: 100%; border-radius: 6px; border: 1px solid var(--tpl-color-rule); display: block; }
  .tpl-photo-video { display: flex; align-items: center; justify-content: center; min-height: 90px; border-radius: 6px; border: 1px solid var(--tpl-color-rule); background: var(--tpl-color-surface); font-size: 11px; color: var(--tpl-color-muted); }
  .tpl-photo-cap { margin: 3px 0 0; font-size: 9px; color: var(--tpl-color-muted); }
  .tpl-photo-stamp { color: var(--tpl-color-ink); }
  .tpl-photo-badge { position: absolute; top: 5px; left: 5px; padding: 1px 6px; border-radius: 999px; background: var(--tpl-color-primary); color: #fff; font-size: 8px; letter-spacing: 0.5px; }
  .tpl-photo-more { margin: 4px 0 0; font-size: 9px; color: var(--tpl-color-muted); }

  .tpl-qa-card { border: 1px solid var(--tpl-color-rule); border-radius: 10px; padding: 14px 16px; margin: 12px 0; break-inside: avoid; }
  .tpl-qa-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .tpl-qa-verdict { padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; background: var(--tpl-color-surface); color: var(--tpl-color-muted); }
  .tpl-qa-pass { background: #EAF3EE; color: var(--tpl-color-success); }
  .tpl-qa-fail { background: #F6E9E8; color: var(--tpl-color-danger); }
  .tpl-qa-score { font-family: var(--tpl-font-display); font-size: 26px; color: var(--tpl-color-ink); }
  .tpl-qa-cats { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
  .tpl-qa-cat { display: flex; align-items: center; gap: 8px; }
  .tpl-qa-cat-label { flex: 0 0 30%; font-size: 10px; color: var(--tpl-color-ink); }
  .tpl-qa-bar { flex: 1 1 auto; height: 6px; border-radius: 999px; background: var(--tpl-color-rule); overflow: hidden; }
  .tpl-qa-bar-fill { display: block; height: 100%; background: var(--tpl-accent); }
  .tpl-qa-cat-score { flex: 0 0 auto; font-size: 10px; color: var(--tpl-color-muted); width: 34px; text-align: right; }
  .tpl-qa-rework { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--tpl-color-rule); }
  .tpl-qa-rework p { margin: 3px 0 0; font-size: 10px; color: var(--tpl-color-ink); }
  .tpl-qa-sev { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #F7EFE0; color: var(--tpl-color-warning); font-size: 9px; font-weight: 700; text-transform: uppercase; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}
