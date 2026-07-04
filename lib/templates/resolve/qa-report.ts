/**
 * QA-report resolver (rebrand doc 03 §4.2, §5.3). Returns the v2 HTML when the
 * doc.qaReport kind is flagged on AND a version is published; otherwise null →
 * the caller keeps its legacy buildQaReportHtml output. Flag OFF by default.
 *
 * The QA data model / submission / tools are untouched — presentation only.
 * S3 key→url is injected so the extractor stays db-free/testable.
 */

import { resolveBrandTokens } from "@/lib/brand/tokens";
import { getAppSettings } from "@/lib/settings";
import { extractQaReportData, type QaReportExtractInput } from "@/lib/reports/qa-report-data";
import { isKindV2Enabled } from "@/lib/templates/flags";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { getPublishedDoc, snapshotRenderedDocument } from "@/lib/templates/store";

const KIND = "doc.qaReport";

export async function resolveQaReportHtml(
  input: QaReportExtractInput & { jobId: string },
  keyToUrl: (key: string) => string,
): Promise<{ html: string } | null> {
  let enabled = false;
  try {
    enabled = await isKindV2Enabled(KIND);
  } catch {
    return null;
  }
  if (!enabled) return null;

  try {
    const published = await getPublishedDoc(KIND);
    if (!published) return null;

    const settings = await getAppSettings();
    const brand = resolveBrandTokens(settings);
    const data = extractQaReportData(input, keyToUrl);

    const html = renderDocumentHtml(published.doc, data, brand, "pdf", { timezone: settings.timezone });

    await snapshotRenderedDocument({
      kind: KIND,
      entityType: "QaReport",
      entityId: input.jobId,
      templateVersionId: published.versionId,
      doc: published.doc,
      data,
    });

    return { html };
  } catch {
    return null;
  }
}
