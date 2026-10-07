import "server-only";
import { db } from "@/lib/db";
import { getTransactionAppSettings } from "@/lib/settings";
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";
import { jobFormRevision } from "@/lib/forms/job-form-revision";
import { listCleanerJobTasks } from "@/lib/job-tasks/service";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { guestSummaryFromReservation, resolveFinalCheckupItems } from "@/lib/forms/final-checkup";

/** Compare historical receipts without changing their recorded revision. */
export async function currentEvidenceRevisions(jobId: string, userIds: string[]) {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { property: true } });
  if (!job) return {};
  const settings = await getTransactionAppSettings(db);
  const effective = await resolveEffectiveJobForm(job, settings, { database: db });
  if (!effective.template) return {};
  const tasks = await listCleanerJobTasks(jobId, db);
  const meta = parseJobInternalNotes(job.internalNotes);
  const adminTasks = tasks.filter(task => task.source === "ADMIN");
  const finalCheckupItems = resolveFinalCheckupItems(settings, { jobType: job.jobType }, {
    guestSummary: guestSummaryFromReservation(meta.reservationContext),
    adminRequests: (adminTasks.length ? adminTasks : meta.specialRequestTasks ?? []).map(task => ({ id: String(task.id), title: String(task.title ?? "") })),
  });
  return Object.fromEntries(userIds.map(userId => [userId, jobFormRevision({ template: effective.template!, job, settings, finalCheckupItems,
    canUseNoPhoto: settings.noPhotoExemptCleanerIds.includes(userId) })]));
}
