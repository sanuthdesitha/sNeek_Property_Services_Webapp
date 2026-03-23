import { JobStatus, PayAdjustmentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { listDisputes } from "@/lib/phase4/disputes";
import { parseCaseDescription } from "@/lib/issues/case-utils";
import type { ClientPortalVisibility } from "@/lib/settings";
import type { ImmediateAttentionItem } from "@/components/shared/immediate-attention-panel";
import { toZonedTime } from "date-fns-tz";

const TZ = "Australia/Sydney";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.ASSIGNED,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

function startOfTodaySydney() {
  const now = toZonedTime(new Date(), TZ);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfTomorrowSydney() {
  const start = startOfTodaySydney();
  return new Date(start.getTime() + 86_400_000);
}

function startOfYesterdaySydney() {
  const start = startOfTodaySydney();
  return new Date(start.getTime() - 86_400_000);
}

function nonZero(items: ImmediateAttentionItem[]) {
  return items.filter((item) => item.count > 0);
}

function isMissingSchemaError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

async function safeCount<T>(query: Promise<T>, fallback: T): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if (isMissingSchemaError(error)) return fallback;
    throw error;
  }
}

export async function getAdminImmediateAttention(): Promise<ImmediateAttentionItem[]> {
  const [pendingPayRequests, flaggedLaundry, unassignedJobs, highCases, newCases, pendingContinuations, pendingClientApprovals, openCases] =
    await Promise.all([
      safeCount(
        db.cleanerPayAdjustment.count({ where: { status: PayAdjustmentStatus.PENDING } }),
        0
      ),
      db.laundryTask.count({ where: { status: "FLAGGED" } }),
      db.job.count({ where: { status: JobStatus.UNASSIGNED } }),
      db.issueTicket.count({
        where: {
          status: { in: ["OPEN", "IN_PROGRESS"] },
          severity: { in: ["HIGH", "CRITICAL"] },
        },
      }),
      db.issueTicket.count({
        where: {
          status: { in: ["OPEN", "IN_PROGRESS"] },
          createdAt: { gte: startOfYesterdaySydney() },
        },
      }),
      listContinuationRequests({ status: "PENDING" }).then((rows) => rows.length),
      listClientApprovals({ status: "PENDING" }).then((rows) => rows.length),
      db.issueTicket.findMany({
        where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
        select: { description: true, status: true },
        take: 1000,
      }),
    ]);

  const now = Date.now();
  const overdueCases = openCases.filter((item) => {
    const dueAtRaw = parseCaseDescription(item.description).metadata.dueAt;
    if (!dueAtRaw) return false;
    const due = new Date(dueAtRaw);
    if (Number.isNaN(due.getTime())) return false;
    return due.getTime() < now;
  }).length;

  return nonZero([
    {
      id: "admin-overdue-cases",
      title: "Overdue cases",
      description: "Case SLA targets have passed and need immediate follow-up.",
      count: overdueCases,
      href: "/admin/cases",
      actionLabel: "Review cases",
      tone: "critical",
    },
    {
      id: "admin-high-cases",
      title: "High-priority open cases",
      description: "Damage/lost-found cases marked high or critical.",
      count: highCases,
      href: "/admin/cases",
      actionLabel: "Open cases",
      tone: "critical",
    },
    {
      id: "admin-new-cases",
      title: "New cases in 24h",
      description: "Recently opened cases waiting triage and ownership.",
      count: newCases,
      href: "/admin/cases",
      actionLabel: "Triage now",
      tone: "warning",
    },
    {
      id: "admin-continuations",
      title: "Pause/continue approvals pending",
      description: "Cleaner continuation requests require an admin decision.",
      count: pendingContinuations,
      href: "/admin/jobs",
      actionLabel: "Open jobs",
      tone: "warning",
    },
    {
      id: "admin-pay-requests",
      title: "Cleaner pay requests pending",
      description: "Extra payment requests are waiting admin review.",
      count: pendingPayRequests,
      href: "/admin/pay-adjustments",
      actionLabel: "Review pay",
      tone: "warning",
    },
    {
      id: "admin-client-approvals",
      title: "Client approvals awaiting response",
      description: "Submitted approval items still pending with clients.",
      count: pendingClientApprovals,
      href: "/admin/approvals",
      actionLabel: "Track approvals",
      tone: "warning",
    },
    {
      id: "admin-flagged-laundry",
      title: "Flagged laundry tasks",
      description: "Laundry windows or buffer conditions need manual intervention.",
      count: flaggedLaundry,
      href: "/admin/laundry",
      actionLabel: "Resolve laundry",
      tone: "critical",
    },
    {
      id: "admin-unassigned-jobs",
      title: "Unassigned jobs",
      description: "Jobs have no cleaner assigned yet.",
      count: unassignedJobs,
      href: "/admin/jobs",
      actionLabel: "Assign jobs",
      tone: "info",
    },
  ]);
}

export async function getCleanerImmediateAttention(cleanerId: string): Promise<ImmediateAttentionItem[]> {
  const todayStart = startOfTodaySydney();

  const [inProgressJobs, overdueAssignedJobs, pendingContinuationRequests, carryForwardTasks, rejectedPayRequests] =
    await Promise.all([
      db.job.count({
        where: {
          status: JobStatus.IN_PROGRESS,
          assignments: { some: { userId: cleanerId, removedAt: null } },
        },
      }),
      db.job.count({
        where: {
          status: {
            in: [
              JobStatus.ASSIGNED,
              JobStatus.IN_PROGRESS,
              JobStatus.PAUSED,
              JobStatus.WAITING_CONTINUATION_APPROVAL,
              JobStatus.SUBMITTED,
              JobStatus.QA_REVIEW,
            ],
          },
          scheduledDate: { lt: todayStart },
          assignments: { some: { userId: cleanerId, removedAt: null } },
        },
      }),
      listContinuationRequests({ requestedByUserId: cleanerId, status: "PENDING" }).then((rows) => rows.length),
      db.issueTicket.count({
        where: {
          status: "OPEN",
          title: { startsWith: "Carry-forward task" },
          job: {
            status: { in: [JobStatus.ASSIGNED, JobStatus.IN_PROGRESS, JobStatus.PAUSED, JobStatus.WAITING_CONTINUATION_APPROVAL] },
            assignments: { some: { userId: cleanerId, removedAt: null } },
          },
        },
      }),
      safeCount(
        db.cleanerPayAdjustment.count({
          where: {
            cleanerId,
            status: PayAdjustmentStatus.REJECTED,
            reviewedAt: { gte: startOfYesterdaySydney() },
          },
        }),
        0
      ),
    ]);

  return nonZero([
    {
      id: "cleaner-in-progress",
      title: "Job currently in progress",
      description: "Continue or submit the active job before starting others.",
      count: inProgressJobs,
      href: "/cleaner/jobs",
      actionLabel: "Open jobs",
      tone: "critical",
    },
    {
      id: "cleaner-overdue",
      title: "Overdue assigned jobs",
      description: "Assigned jobs are still open after scheduled date.",
      count: overdueAssignedJobs,
      href: "/cleaner/jobs",
      actionLabel: "Catch up",
      tone: "warning",
    },
    {
      id: "cleaner-continuation",
      title: "Continuation requests pending",
      description: "Pause/continue requests are awaiting admin decision.",
      count: pendingContinuationRequests,
      href: "/cleaner/jobs",
      actionLabel: "Track status",
      tone: "warning",
    },
    {
      id: "cleaner-carry-forward",
      title: "Carry-forward tasks to complete",
      description: "High-priority pass-to-next-clean tasks are still unresolved.",
      count: carryForwardTasks,
      href: "/cleaner/jobs",
      actionLabel: "Complete tasks",
      tone: "warning",
    },
    {
      id: "cleaner-rejected-pay",
      title: "Rejected pay requests",
      description: "Review admin notes and resubmit if needed.",
      count: rejectedPayRequests,
      href: "/cleaner/pay-requests",
      actionLabel: "Review requests",
      tone: "info",
    },
  ]);
}

export async function getClientImmediateAttention(input: {
  clientId: string | null;
  visibility: ClientPortalVisibility;
}): Promise<ImmediateAttentionItem[]> {
  if (!input.clientId) return [];
  const clientId = input.clientId;

  const [pendingApprovals, ongoingToday, lowStockCount, highPriorityCases] = await Promise.all([
    input.visibility.showApprovals
      ? listClientApprovals({ clientId, status: "PENDING" }).then((rows) => rows.length)
      : Promise.resolve(0),
    db.job.count({
      where: {
        property: { clientId },
        status: { in: ACTIVE_JOB_STATUSES },
        scheduledDate: { lt: startOfTomorrowSydney() },
      },
    }),
    input.visibility.showInventory
      ? db.propertyStock.count({
          where: {
            property: { clientId },
            onHand: { lte: db.propertyStock.fields.reorderThreshold },
          },
        })
      : Promise.resolve(0),
    input.visibility.showCases
      ? db.issueTicket.count({
          where: {
            job: { property: { clientId } },
            status: { in: ["OPEN", "IN_PROGRESS"] },
            severity: { in: ["HIGH", "CRITICAL"] },
          },
        })
      : Promise.resolve(0),
  ]);

  const openDisputes = input.visibility.showApprovals
    ? (await listDisputes({ clientId })).filter((row) => row.status === "OPEN" || row.status === "UNDER_REVIEW").length
    : 0;

  return nonZero([
    {
      id: "client-approvals",
      title: "Approvals awaiting your response",
      description: "Admin-raised approvals are waiting for your confirmation.",
      count: pendingApprovals,
      href: "/client/approvals",
      actionLabel: "Respond now",
      tone: "critical",
    },
    {
      id: "client-disputes",
      title: "Open dispute cases",
      description: "Disputes are active and may require your comments.",
      count: openDisputes,
      href: "/client/cases",
      actionLabel: "Open cases",
      tone: "warning",
    },
    {
      id: "client-today-jobs",
      title: "Active services today",
      description: "Jobs scheduled today or already in progress.",
      count: ongoingToday,
      href: "/client/calendar",
      actionLabel: "View schedule",
      tone: "info",
    },
    {
      id: "client-low-stock",
      title: "Low inventory items",
      description: "Supplies are below threshold in one or more properties.",
      count: lowStockCount,
      href: "/client/inventory",
      actionLabel: "Review stock",
      tone: "warning",
    },
    {
      id: "client-high-cases",
      title: "High-priority property cases",
      description: "High/critical cases have been logged for your properties.",
      count: highPriorityCases,
      href: "/client/cases",
      actionLabel: "View cases",
      tone: "warning",
    },
  ]);
}
