import "server-only";
/**
 * Submission figures for the forms on one library page: Avg time, Completion
 * and the "required question never answered" usage check. One read of the
 * page's recent submissions; definitions in submission-stats.ts.
 */
import { FormTemplateVersionKind } from "@prisma/client";
import { db } from "@/lib/db";
import {
  statsWindowStart,
  summariseTemplateUsage,
  USAGE_CHECK_DAYS,
  type SubmissionSample,
  type TemplateUsageFigures,
} from "./submission-stats";

export async function loadUsageFigures(
  forms: Array<{ id: string; schema: unknown }>,
  now: Date,
): Promise<Map<string, TemplateUsageFigures>> {
  const result = new Map<string, TemplateUsageFigures>();
  if (forms.length === 0) return result;
  const ids = forms.map((form) => form.id);
  const since = new Date(Math.min(statsWindowStart(now).getTime(), now.getTime() - USAGE_CHECK_DAYS * 86_400_000));
  const [samples, liveSince] = await Promise.all([
    db.formSubmission.findMany({
      where: { templateId: { in: ids }, createdAt: { gte: since } },
      select: { templateId: true, data: true, createdAt: true },
    }),
    db.formTemplateVersion.groupBy({
      by: ["templateId"],
      where: { templateId: { in: ids }, kind: FormTemplateVersionKind.PUBLISHED },
      _max: { createdAt: true },
    }),
  ]);
  const samplesByTemplate = new Map<string, SubmissionSample[]>();
  for (const sample of samples) {
    const list = samplesByTemplate.get(sample.templateId) ?? [];
    list.push(sample);
    samplesByTemplate.set(sample.templateId, list);
  }
  const liveSinceByTemplate = new Map(liveSince.map((row) => [row.templateId, row._max.createdAt ?? null]));
  for (const form of forms) {
    result.set(
      form.id,
      summariseTemplateUsage({
        schema: form.schema,
        samples: samplesByTemplate.get(form.id) ?? [],
        now,
        liveSince: liveSinceByTemplate.get(form.id) ?? null,
      }),
    );
  }
  return result;
}
