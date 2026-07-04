/**
 * Client-invoice HTML resolver (rebrand doc 03 §5.3): the v2 path behind the
 * per-kind flag, with instant legacy fallback.
 *
 *   flag off  OR  no published doc  OR  render error  →  legacy HTML (byte-identical to today)
 *   flag on   AND published doc                       →  v2 render + RenderedDocument snapshot
 *
 * The invoice data model / lines / Xero path are untouched — only presentation
 * gains a v2 branch. Money stays raw numbers into the template (never recomputed).
 */

import { resolveBrandTokens } from "@/lib/brand/tokens";
import { getAppSettings } from "@/lib/settings";
import { buildClientInvoiceHtml, type getClientInvoice } from "@/lib/billing/client-invoices";
import { toInvoiceContractData } from "@/lib/templates/adapters/client-invoice";
import { isKindV2Enabled } from "@/lib/templates/flags";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { getPublishedDoc, snapshotRenderedDocument } from "@/lib/templates/store";

type Invoice = NonNullable<Awaited<ReturnType<typeof getClientInvoice>>>;

const KIND = "doc.clientInvoice";

export interface InvoiceRenderContext {
  companyName: string;
  logoUrl?: string | null;
  invoicingSettings?: Parameters<typeof buildClientInvoiceHtml>[3];
  /** Persist a RenderedDocument snapshot when rendering via v2. */
  snapshot?: boolean;
}

export async function resolveClientInvoiceHtml(
  invoice: Invoice,
  ctx: InvoiceRenderContext,
): Promise<{ html: string; source: "v2" | "legacy" }> {
  const legacy = () => ({
    html: buildClientInvoiceHtml(invoice, ctx.companyName, ctx.logoUrl, ctx.invoicingSettings),
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
    const data = toInvoiceContractData(invoice, {
      bankName: ctx.invoicingSettings?.bankName,
      bankBsb: ctx.invoicingSettings?.bankBsb,
      bankAccountNumber: ctx.invoicingSettings?.bankAccountNumber,
      bankAccountName: ctx.invoicingSettings?.bankAccountName,
      paymentNote: ctx.invoicingSettings?.paymentNote,
      defaultPaymentTermsDays: ctx.invoicingSettings?.defaultPaymentTermsDays,
    });

    const html = renderDocumentHtml(published.doc, data, brand, "pdf", {
      timezone: settings.timezone,
    });

    if (ctx.snapshot) {
      await snapshotRenderedDocument({
        kind: KIND,
        entityType: "ClientInvoice",
        entityId: invoice.id,
        templateVersionId: published.versionId,
        doc: published.doc,
        data,
      });
    }

    return { html, source: "v2" };
  } catch {
    // Any v2 failure falls back to the proven legacy renderer.
    return legacy();
  }
}
