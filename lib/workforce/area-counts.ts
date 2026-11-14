import "server-only";
/**
 * Tab counts and the introduction of the Workforce area header. Each count is
 * a real total; one that could not be read is left out rather than shown as 0.
 */
import { CoachingRecordStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { loadComplianceData, type ComplianceData } from "./compliance-load";
import type { WorkforceTabCounts } from "./workforce-tabs";

export type WorkforceAreaSummary = {
  counts: WorkforceTabCounts;
  cleaners: number | null;
  laundry: number | null;
};

/** Pass the Compliance tab's own data to avoid reading it twice. */
export async function loadWorkforceAreaSummary(known?: ComplianceData): Promise<WorkforceAreaSummary> {
  const [compliance, coachingOpen, cleaners, laundry] = await Promise.all([
    known ?? loadComplianceData(),
    db.coachingRecord.count({ where: { status: CoachingRecordStatus.OPEN } }).catch(() => null),
    db.user.count({ where: { role: Role.CLEANER, isActive: true } }).catch(() => null),
    db.user.count({ where: { role: Role.LAUNDRY, isActive: true } }).catch(() => null),
  ]);
  const counts: WorkforceTabCounts = {};
  if (compliance.status === "ready") counts.compliance = { value: compliance.figures.needsAction };
  if (cleaners !== null && laundry !== null) counts.roster = { value: cleaners + laundry };
  if (coachingOpen !== null) counts.coaching = { value: coachingOpen, suffix: "open" };
  return { counts, cleaners, laundry };
}
