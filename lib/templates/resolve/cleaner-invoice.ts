/**
 * Cleaner-invoice (RCTI) HTML resolver (rebrand doc 03 §4.2, §5.3): the v2 path
 * behind the per-kind flag, with instant legacy fallback.
 *
 *   flag off / no published doc / error → legacy buildCleanerInvoiceHtml
 *   flag on + published doc             → v2 render (+ optional snapshot)
 *
 * Cleaner-pay math (getCleanerInvoiceData) is untouched — presentation only.
 * CleanerInvoiceData is already assembled (no db/S3), so the adapter is pure.
 */

import { resolveBrandTokens } from "@/lib/brand/tokens";
import { getAppSettings } from "@/lib/settings";
import { buildCleanerInvoiceHtml, type CleanerInvoiceData } from "@/lib/cleaner/invoice";
import { toCleanerInvoiceContractData } from "@/lib/templates/adapters/cleaner-invoice";
import { isKindV2Enabled } from "@/lib/templates/flags";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { getPublishedDoc, snapshotRenderedDocument } from "@/lib/templates/store";

const KIND = "doc.cleanerInvoice";

export async function resolveCleanerInvoiceHtml(
  data: CleanerInvoiceData,
  opts: { snapshot?: boolean; entityId?: string } = {},
): Promise<{ html: string; source: "v2" | "legacy" }> {
  const legacy = () => ({ html: buildCleanerInvoiceHtml(data), source: "legacy" as const });

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
    const contract = toCleanerInvoiceContractData(data);

    const html = renderDocumentHtml(published.doc, contract, brand, "pdf", { timezone: settings.timezone });

    if (opts.snapshot && opts.entityId) {
      await snapshotRenderedDocument({
        kind: KIND,
        entityType: "CleanerInvoice",
        entityId: opts.entityId,
        templateVersionId: published.versionId,
        doc: published.doc,
        data: contract,
      });
    }

    return { html, source: "v2" };
  } catch {
    return legacy();
  }
}
