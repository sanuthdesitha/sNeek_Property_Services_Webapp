/**
 * Client-report HTML resolver (rebrand doc 03 §4.2, §5.3): the v2 path behind
 * the per-kind flag, with instant legacy fallback.
 *
 *   flag off / no published doc / render error → legacy buildReportHtml
 *   flag on + published doc                    → v2 render (checklistSection +
 *                                                photoGrid + qaScoreCard)
 *
 * The form engine, submission storage, and __templateSchema snapshot are
 * untouched — the v2 checklist consumes the SAME visibility/value semantics via
 * generator.extractClientReportData (which reuses the legacy helpers).
 */

import { resolveBrandTokens } from "@/lib/brand/tokens";
import { getAppSettings } from "@/lib/settings";
import { buildReportHtml, extractClientReportData } from "@/lib/reports/generator";
import { isKindV2Enabled } from "@/lib/templates/flags";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { getPublishedDoc, snapshotRenderedDocument } from "@/lib/templates/store";

const KIND = "doc.clientReport";

export interface ClientReportRenderInput {
  job: any;
  submission: any;
  qa: any;
  qaSubmission: any;
  localDate: string;
  settings: any;
  theme: any;
  actionUrl?: string | null;
  /** Persist a RenderedDocument snapshot when rendering via v2. */
  snapshot?: boolean;
}

export async function resolveClientReportHtml(
  input: ClientReportRenderInput,
): Promise<{ html: string; source: "v2" | "legacy" }> {
  const legacy = () => ({
    html: buildReportHtml({
      job: input.job,
      submission: input.submission,
      qa: input.qa,
      qaSubmission: input.qaSubmission,
      localDate: input.localDate,
      settings: input.settings,
      theme: input.theme,
    }),
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

    const settings = input.settings ?? (await getAppSettings());
    const brand = resolveBrandTokens(settings);
    const data = extractClientReportData({
      job: input.job,
      submission: input.submission,
      qa: input.qa,
      qaSubmission: input.qaSubmission,
      localDate: input.localDate,
      actionUrl: input.actionUrl ?? undefined,
    });

    const html = renderDocumentHtml(published.doc, data, brand, "pdf", {
      timezone: settings.timezone,
    });

    if (input.snapshot && input.job?.id) {
      await snapshotRenderedDocument({
        kind: KIND,
        entityType: "Report",
        entityId: String(input.job.id),
        templateVersionId: published.versionId,
        doc: published.doc,
        data,
      });
    }

    return { html, source: "v2" };
  } catch {
    return legacy();
  }
}
