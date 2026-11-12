/**
 * "Monthly" questions shown on a clean that is submitted but not yet approved.
 *
 * The property's last-shown date (PropertyRotationState.lastCompletedAt) is
 * stamped only when a clean is counted (approved). A second clean at the same
 * property in the same month, before the first is approved, would otherwise
 * show the monthly question again. So the resolver also reads that property's
 * submissions in the current organisation month whose job is still waiting
 * for approval (SUBMITTED or QA_REVIEW, not rework, not the job being
 * resolved) and treats a monthly question as shown when the stored effective
 * schema of such a submission (`__templateSchema`) contained it.
 *
 * Bounded: at most PENDING_SUBMISSION_SCAN submissions are read. When the
 * first clean is rejected or reset (its job leaves SUBMITTED / QA_REVIEW), it
 * no longer counts and the question is due again.
 */
import { fromZonedTime } from "date-fns-tz";
import type { Prisma } from "@prisma/client";
import { calendarMonthKey, collectMonthlyItems } from "./rotation-schema";

export const PENDING_SUBMISSION_SCAN = 25;
export const AWAITING_APPROVAL_STATUSES = ["SUBMITTED", "QA_REVIEW"] as const;

export type MonthlyPendingReader = {
  formSubmission: {
    findMany: (args: {
      where: Prisma.FormSubmissionWhereInput;
      orderBy: Prisma.FormSubmissionOrderByWithRelationInput;
      take: number;
      select: { data: true };
    }) => Promise<Array<{ data: unknown }>>;
  };
};

/** The first instant of `now`'s calendar month in the organisation timezone. */
export function monthStart(now: Date, timeZone: string): Date {
  return fromZonedTime(`${calendarMonthKey(now, timeZone)}-01T00:00:00`, timeZone);
}

/** Monthly item keys a stored submission showed (from its effective schema). */
export function monthlyKeysShownIn(data: unknown): string[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const schema = (data as { __templateSchema?: { sections?: unknown } }).__templateSchema;
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  return collectMonthlyItems({ sections });
}

/**
 * Monthly keys (among `keys`) already shown this month on another clean at
 * the property that is submitted but not yet approved.
 */
export async function monthlyKeysShownOnPendingCleans(
  reader: MonthlyPendingReader,
  input: { propertyId: string; excludeJobId?: string | null; keys: readonly string[]; now: Date; timeZone: string },
): Promise<Set<string>> {
  const wanted = new Set(input.keys);
  const shown = new Set<string>();
  if (wanted.size === 0) return shown;
  const rows = await reader.formSubmission.findMany({
    where: {
      createdAt: { gte: monthStart(input.now, input.timeZone) },
      job: {
        propertyId: input.propertyId,
        status: { in: [...AWAITING_APPROVAL_STATUSES] },
        isRework: false,
        ...(input.excludeJobId ? { id: { not: input.excludeJobId } } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: PENDING_SUBMISSION_SCAN,
    select: { data: true },
  });
  for (const row of rows) {
    for (const key of monthlyKeysShownIn(row.data)) if (wanted.has(key)) shown.add(key);
  }
  return shown;
}
