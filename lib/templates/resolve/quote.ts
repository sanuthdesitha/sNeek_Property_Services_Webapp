/**
 * Quote HTML resolver (rebrand doc 03 §5.3): the v2 path behind the per-kind
 * flag, with instant legacy fallback.
 *
 *   flag off / no published doc / render error → legacy buildQuoteHtml
 *   flag on + published doc                    → v2 render (+ optional snapshot)
 *
 * The pricing calculator, quote line items, and totals are untouched — only
 * presentation gains a v2 branch. Money stays raw numbers into the template.
 */

import { resolveBrandTokens } from "@/lib/brand/tokens";
import { getAppSettings } from "@/lib/settings";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";
import { toQuoteContractData } from "@/lib/templates/adapters/quote";
import { isKindV2Enabled } from "@/lib/templates/flags";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { getPublishedDoc, snapshotRenderedDocument } from "@/lib/templates/store";

const KIND = "doc.quote";

export interface QuoteRenderContext {
  branding?: { companyName?: string; logoUrl?: string; companyAddress?: string };
  actionUrl?: string | null;
  /** Persist a RenderedDocument snapshot when rendering via v2. */
  snapshot?: boolean;
}

export async function resolveQuoteHtml(
  // Loose type: buildQuoteHtml already takes `any`; the adapter reads defensively.
  quote: unknown,
  ctx: QuoteRenderContext = {},
): Promise<{ html: string; source: "v2" | "legacy" }> {
  const legacy = () => ({
    html: buildQuoteHtml(quote as never, ctx.branding),
    source: "legacy" as const,
  });

  let enabled = false;
  try {
    enabled = await isKindV2Enabled(KIND);
  } catch {
    return legacy();
  }
  if (!enabled) return legacy();

  try {
    const published = await getPublishedDoc(KIND);
    if (!published) return legacy();

    const settings = await getAppSettings();
    const brand = resolveBrandTokens(settings);
    const data = toQuoteContractData(quote as Parameters<typeof toQuoteContractData>[0], ctx.actionUrl);

    const html = renderDocumentHtml(published.doc, data, brand, "pdf", {
      timezone: settings.timezone,
    });

    if (ctx.snapshot) {
      const entityId = (quote as { id?: string })?.id;
      if (entityId) {
        await snapshotRenderedDocument({
          kind: KIND,
          entityType: "Quote",
          entityId,
          templateVersionId: published.versionId,
          doc: published.doc,
          data,
        });
      }
    }

    return { html, source: "v2" };
  } catch {
    return legacy();
  }
}
