import "server-only";
/**
 * Real counts behind the "Reject submissions that break these checks"
 * switch: submissions that recorded extended-rule warnings
 * (`data.__validationWarnings`, written by the cleaner submit route) in the
 * last 14 and 30 days — in total, by check and by form — plus the most recent
 * ones to open. Aggregated in the database. A failed read returns null so the
 * screen shows "–", never 0.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const WARNING_WINDOWS = [14, 30] as const;

export type WarningCount = { d14: number; d30: number };

export type ValidationWarningStats = {
  /** Submissions in the window (the denominator). */
  submissions: WarningCount;
  /** Submissions with at least one warning. */
  withWarnings: WarningCount;
  byRule: Array<{ rule: string } & WarningCount>;
  byForm: Array<{ templateId: string; name: string } & WarningCount>;
  recent: Array<{ submissionId: string; jobId: string; templateId: string; formName: string; createdAt: string; rules: string[] }>;
};

type CountRow = { d14: bigint | number | null; d30: bigint | number | null };

function n(value: bigint | number | null | undefined): number {
  return typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : 0;
}

export async function loadValidationWarningStats(now = new Date()): Promise<ValidationWarningStats> {
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const since14 = new Date(now.getTime() - 14 * 86_400_000);
  const hasWarnings = Prisma.sql`jsonb_typeof(s."data"->'__validationWarnings') = 'array' AND jsonb_array_length(s."data"->'__validationWarnings') > 0`;

  const [all, warned, byRule, byForm, recent] = await Promise.all([
    db.$queryRaw<CountRow[]>`SELECT count(*) FILTER (WHERE s."createdAt" >= ${since14}) AS d14, count(*) AS d30
      FROM "FormSubmission" s WHERE s."createdAt" >= ${since30}`,
    db.$queryRaw<CountRow[]>`SELECT count(*) FILTER (WHERE s."createdAt" >= ${since14}) AS d14, count(*) AS d30
      FROM "FormSubmission" s WHERE s."createdAt" >= ${since30} AND ${hasWarnings}`,
    db.$queryRaw<Array<CountRow & { rule: string | null }>>`SELECT w->>'rule' AS rule,
        count(DISTINCT s.id) FILTER (WHERE s."createdAt" >= ${since14}) AS d14, count(DISTINCT s.id) AS d30
      FROM "FormSubmission" s CROSS JOIN LATERAL jsonb_array_elements(s."data"->'__validationWarnings') w
      WHERE s."createdAt" >= ${since30} AND ${hasWarnings}
      GROUP BY 1 ORDER BY d30 DESC`,
    db.$queryRaw<Array<CountRow & { templateId: string; name: string }>>`SELECT s."templateId" AS "templateId", t."name" AS name,
        count(*) FILTER (WHERE s."createdAt" >= ${since14}) AS d14, count(*) AS d30
      FROM "FormSubmission" s JOIN "FormTemplate" t ON t.id = s."templateId"
      WHERE s."createdAt" >= ${since30} AND ${hasWarnings}
      GROUP BY s."templateId", t."name" ORDER BY d30 DESC LIMIT 50`,
    db.$queryRaw<Array<{ id: string; jobId: string; templateId: string; name: string; createdAt: Date; rules: string[] | null }>>`SELECT s.id, s."jobId" AS "jobId", s."templateId" AS "templateId", t."name" AS name, s."createdAt" AS "createdAt",
        ARRAY(SELECT DISTINCT w->>'rule' FROM jsonb_array_elements(s."data"->'__validationWarnings') w) AS rules
      FROM "FormSubmission" s JOIN "FormTemplate" t ON t.id = s."templateId"
      WHERE s."createdAt" >= ${since30} AND ${hasWarnings}
      ORDER BY s."createdAt" DESC LIMIT 20`,
  ]);

  return {
    submissions: { d14: n(all[0]?.d14), d30: n(all[0]?.d30) },
    withWarnings: { d14: n(warned[0]?.d14), d30: n(warned[0]?.d30) },
    byRule: byRule.map((row) => ({ rule: row.rule ?? "unknown", d14: n(row.d14), d30: n(row.d30) })),
    byForm: byForm.map((row) => ({ templateId: row.templateId, name: row.name, d14: n(row.d14), d30: n(row.d30) })),
    recent: recent.map((row) => ({
      submissionId: row.id,
      jobId: row.jobId,
      templateId: row.templateId,
      formName: row.name,
      createdAt: row.createdAt.toISOString(),
      rules: (row.rules ?? []).filter((rule): rule is string => typeof rule === "string"),
    })),
  };
}
