import "server-only";
/**
 * Whether a cleaner's submission for a job is held to the extended rules:
 * the organisation switch (settings.formValidation) and the cleaner's earliest
 * clock-in on the job (see validation-enforcement.ts). The time log is read
 * only when the switch is on, so nothing changes while it is off.
 */
import type { Prisma } from "@prisma/client";
import { shouldEnforceExtended, type FormValidationSettings } from "./validation-enforcement";

type TimeLogReader = { timeLog: Pick<Prisma.TransactionClient["timeLog"], "findFirst"> };

export async function extendedEnforcementFor(
  database: TimeLogReader,
  input: { jobId: string; userId: string; settings: FormValidationSettings | null | undefined },
): Promise<{ enforce: boolean; workStartedAt: Date | null }> {
  if (!input.settings?.enforceExtended) return { enforce: false, workStartedAt: null };
  const first = await database.timeLog.findFirst({
    where: { jobId: input.jobId, userId: input.userId },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true },
  });
  const workStartedAt = first?.startedAt ?? null;
  return { enforce: shouldEnforceExtended(input.settings, workStartedAt), workStartedAt };
}
