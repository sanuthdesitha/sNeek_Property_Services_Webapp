/**
 * renderEmail — TemplateDoc → 600px table-based, inline-styled email HTML
 * (rebrand doc 03 §1.1). Successor to wrapEmailHtml(): same proven shell
 * lineage (page background → centered 600px card), tokens resolved to literal
 * hex inline because Gmail/Outlook strip <style>.
 *
 * Output plugs into the UNCHANGED sendEmailDetailed() chokepoint — gating,
 * suppression, and kind semantics are untouched by construction (§5.3).
 */

import { resolveTokenRef, type BrandTokens } from "@/lib/brand/tokens";
import type { TemplateDoc } from "../model";
import { renderBlocks, type RenderOptions } from "./engine";

export interface RenderedEmail {
  html: string;
  /** Plain-text part assembled from text-capable blocks. */
  text: string;
}

export function renderEmail(
  doc: TemplateDoc,
  data: unknown,
  brand: BrandTokens,
  opts: RenderOptions = {},
): RenderedEmail {
  const accent = doc.theme.accent ? resolveTokenRef(brand, doc.theme.accent) : brand.color.accent;
  const pageBg = resolveTokenRef(brand, doc.page.background || "color.surface");
  const body = renderBlocks(doc, "email", "renderEmail", data, brand, opts);
  const text = renderBlocks(doc, "email", "renderText", data, brand, opts);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeTitle(brand.identity.companyName)}</title>
</head>
<body style="margin:0;padding:0;background:${pageBg};-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${pageBg};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${brand.color.card};border-radius:${brand.radius.card}px;border:1px solid ${brand.color.rule};border-top:3px solid ${accent};">
${body}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text };
}

function escapeTitle(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
