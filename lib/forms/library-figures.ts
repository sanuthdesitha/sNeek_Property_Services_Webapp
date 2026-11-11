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

/**
 * The library reads the submissions behind Avg time, Completion and the usage
 * check for the WHOLE filtered set (so sorting and "Has problems" are right
 * across pages) only while that is at most this many submissions.
 */
export const FIGURES_MAX_SUBMISSIONS = 20_000;

/** Earliest submission any figure reads (stats window or usage window). */
export function figuresWindowStart(now: Date): Date {
  return new Date(Math.min(statsWindowStart(now).getTime(), now.getTime() - USAGE_CHECK_DAYS * 86_400_000));
}

/** How many submissions the figures for these forms would read (a database count). */
export async function countFigureSubmissions(ids: string[], now: Date): Promise<number> {
  if (ids.length === 0) return 0;
  return db.formSubmission.count({ where: { templateId: { in: ids }, createdAt: { gte: figuresWindowStart(now) } } });
}

export async function loadUsageFigures(
  forms: Array<{ id: string; schema: unknown }>,
  now: Date,
): Promise<Map<string, TemplateUsageFigures>> {
  const result = new Map<string, TemplateUsageFigures>();
  if (forms.length === 0) return result;
  const ids = forms.map((form) => form.id);
  const since = figuresWindowStart(now);
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
