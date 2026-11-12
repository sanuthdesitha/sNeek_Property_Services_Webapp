import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { allOpsLevels, type OpsLevels } from "@/lib/rbac/ops-catalog";
import { urgentStockOfficeAllowed } from "@/lib/inventory/urgent-stock";
import { getAppSettings } from "@/lib/settings";
import { formatServiceDate } from "@/lib/time/service-date";
import { chargeForJob, loadChargeInputs } from "@/lib/jobs/list-row-extras";
import { buildBriefingProof } from "@/lib/jobs/job-page/briefing";
import { jobPageViewHref, resolveJobPageTarget, type JobPageView } from "@/lib/jobs/job-page/deep-link";
import { loadJobPageJob, loadJobPageRelated, loadUserNames } from "@/lib/jobs/job-page/load";
import type { JobRateCharge } from "@/lib/jobs/job-page/money";
import { buildContinuationRows, buildManageJob, buildPanelAssignments, buildSubmissionRows, buildTaskRows } from "@/lib/jobs/job-page/rows";
import { buildJobPageModel } from "@/lib/jobs/job-page/view-model";
import { ETabs, type ETabItem } from "@/components/v2/ui/primitives";
import { JobArrival } from "@/components/v2/admin/jobs/detail/job-arrival";
import { JobHeavyTab } from "@/components/v2/admin/jobs/detail/job-heavy-tabs";
import type { JobPageData } from "@/components/v2/admin/jobs/detail/job-page-data";
import { JobPageHeader } from "@/components/v2/admin/jobs/detail/job-page-header";
import { JobRail } from "@/components/v2/admin/jobs/detail/job-rail";
import { JobRestoreProvider } from "@/components/v2/admin/jobs/detail/job-restore";
import { JobTimeline } from "@/components/v2/admin/jobs/detail/job-timeline";

export const metadata = { title: "Job · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Admin job page ("Job full view", owner-approved design 2026-11): header with
 * one status-driven primary action and a More menu, the eight-step stage bar,
 * key facts, the job as one timeline (Booking → Invoice and pay) with tabs
 * for heavy content, and a right rail (People, Property access, Money,
 * Linked, Messages). Every function of the old eleven-tab page has a home
 * here; old `?tab=` links and `#chat` land on the matching stage or tab
 * (lib/jobs/job-page/deep-link.ts). No new permission: the same role gate,
 * and an operations manager's packs decide read-only and which linked
 * workspaces appear.
 */
export default async function AdminJobDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const job = await loadJobPageJob(params.id);
  if (!job) notFound();

  // A corrupt policy must not grant access: fall back to everything off.
  const levels: OpsLevels | null = await getOpsAccess(session.user).catch(() => allOpsLevels("off"));
  const [canReadUrgentStock, settings] = await Promise.all([
    urgentStockOfficeAllowed(session.user, "read").catch(() => false),
    getAppSettings(),
  ]);
  const timeZone = settings.timezone || "Australia/Sydney";
  const viewer = { isAdmin: session.user.role === Role.ADMIN, readOnly: levels !== null && levels.jobs !== "manage" };
  const related = await loadJobPageRelated(job, { levels, canReadUrgentStock });

  const names = await loadUserNames(related.continuations.flatMap((row) => [row.requestedByUserId, row.decidedByUserId ?? ""]));
  const taskRows = buildTaskRows(job);
  const continuationRows = buildContinuationRows(related.continuations, names);
  const pendingTaskCount = taskRows.filter((task) => task.approvalStatus === "PENDING_APPROVAL").length;
  const pendingContinuationCount = continuationRows.filter((row) => row.status === "PENDING").length;

  let rateCharge: JobRateCharge = { amount: job.fixedPrice, source: job.fixedPrice != null ? "FIXED_JOB" : "MISSING" };
  if (job.property) {
    try {
      const chargeJob = { jobType: job.jobType, propertyId: job.property.id, fixedPrice: job.fixedPrice };
      const charge = chargeForJob(chargeJob, await loadChargeInputs([chargeJob]));
      rateCharge = { amount: charge.missing ? null : charge.amount, source: charge.source };
    } catch {
      // Keep the fixed price (or "No rate"); never invent a charge.
    }
  }

  const now = new Date();
  const model = buildJobPageModel({ job, related, viewer, timeZone, now, rateCharge, pendingTaskCount, pendingContinuationCount });
  const briefingTasks = job.jobTasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    source: String(task.source ?? ""),
    approvalStatus: String(task.approvalStatus ?? ""),
    visibleToCleaner: task.visibleToCleaner,
    executionStatus: String(task.executionStatus ?? "OPEN"),
  }));
  const ackUserIds = Object.keys(model.meta.startBriefingAcks ?? {});
  const briefing = buildBriefingProof({ meta: model.meta, tasks: briefingTasks, names: await loadUserNames(ackUserIds), timeZone });

  const data: JobPageData = {
    job,
    related,
    model,
    viewer,
    timeZone,
    propLabel: [job.property?.name, job.property?.suburb].filter(Boolean).join(" · ") || "Property",
    scheduledLabel: formatServiceDate(job.scheduledDate, "EEE d MMM yyyy", "Date not set"),
    timeLabel: job.startTime ? `${job.startTime}${job.dueTime ? ` – ${job.dueTime}` : ""}${job.endTime ? ` (ended ${job.endTime})` : ""}` : "No time set",
    taskRows,
    continuationRows,
    submissionRows: buildSubmissionRows(job),
    manageJob: buildManageJob(job),
    panelAssignments: buildPanelAssignments(job),
    briefing,
    pendingTaskCount,
    pendingContinuationCount,
  };

  const target = resolveJobPageTarget(searchParams);
  const checklist = model.facts.find((fact) => fact.key === "checklist");
  const photoCount = job.formSubmissions[0]?.media.length ?? 0;
  const count = (value: number | null | undefined) => (typeof value === "number" && value > 0 ? ` ${value}` : "");
  const tabs: ETabItem[] = [
    { key: "timeline", label: "Timeline" },
    { key: "answers", label: `Form answers${checklist && !checklist.unknown ? ` ${checklist.value.split(" of ")[1] ?? ""}` : ""}`.trimEnd() },
    { key: "photos", label: `Photos${count(photoCount)}` },
    { key: "clock", label: "Clock and GPS" },
    { key: "messages", label: `Messages${count(related.messageCount)}` },
    { key: "history", label: `History${count(related.auditCount)}` },
  ];

  return (
    <JobRestoreProvider jobId={job.id}>
      <div className="space-y-4">
        <JobArrival jobId={job.id} view={target.view} anchor={target.anchor} />
        <JobPageHeader data={data} now={now} initialOpen={target.open} />
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
          <section aria-label="Job timeline" className="flex min-w-0 flex-1 flex-col gap-3">
            <ETabs items={tabs} active={target.view} hrefFor={(key) => jobPageViewHref(job.id, key as JobPageView)} ariaLabel="Job views" />
            {target.view === "timeline" ? <JobTimeline data={data} now={now} /> : <JobHeavyTab view={target.view} data={data} />}
          </section>
          <JobRail data={data} />
        </div>
      </div>
    </JobRestoreProvider>
  );
}
