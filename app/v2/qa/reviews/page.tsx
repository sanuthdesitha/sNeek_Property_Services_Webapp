import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { qaAssignmentOwnerWhere } from "@/lib/qa/ownership";
import { EBadge, EButton, ECard, ECardBody, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";
import { ChevronRight } from "lucide-react";

export const metadata = { title: "Reviews · Estate QA" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function statusTone(status: QaAssignmentStatus): Tone {
  switch (status) {
    case QaAssignmentStatus.COMPLETED:
      return "success";
    case QaAssignmentStatus.IN_PROGRESS:
      return "info";
    case QaAssignmentStatus.CANCELLED:
      return "neutral";
    case QaAssignmentStatus.OPEN:
      return "warning";
    default:
      return "primary";
  }
}

type ReviewRow = {
  id: string;
  status: QaAssignmentStatus;
  onSiteMinutes: number | null;
  completedAt: Date | null;
  createdAt: Date;
  assignedTo: { name: string | null } | null;
  job: {
    id: string;
    scheduledDate: Date | null;
    property: { name: string | null; suburb: string | null } | null;
    assignments: { user: { name: string | null } | null }[];
    qaReviews: {
      score: number | null;
      passed: boolean | null;
      createdAt: Date;
      cleanerAcknowledgedAt: Date | null;
    }[];
  } | null;
};

/**
 * An inspector's own history. This query previously had NO `where` clause at
 * all, so every inspector saw the last 30 assignments in the entire business —
 * other inspectors' work included, each with a working "open" link. Admins and
 * ops managers keep the whole-team view; an inspector sees only what they were
 * assigned or picked up.
 */
async function getReviews(viewer: { id: string; role: Role }): Promise<ReviewRow[]> {
  const scoped =
    viewer.role === Role.ADMIN || viewer.role === Role.OPS_MANAGER
      ? {}
      : qaAssignmentOwnerWhere(viewer.id);
  return db.qaAssignment
    .findMany({
      where: scoped,
      orderBy: [{ updatedAt: "desc" }],
      take: 30,
      select: {
        id: true,
        status: true,
        onSiteMinutes: true,
        // A review history without WHEN it happened is unusable — these drive
        // the date column below.
        completedAt: true,
        createdAt: true,
        assignedTo: { select: { name: true } },
        job: {
          select: {
            id: true,
            scheduledDate: true,
            property: { select: { name: true, suburb: true } },
            assignments: { select: { user: { select: { name: true } } }, take: 1 },
            // The verdict — the actual point of a QA review.
            qaReviews: {
              where: { kind: "QA" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { score: true, passed: true, createdAt: true, cleanerAcknowledgedAt: true },
            },
          },
        },
      },
    })
    .catch(() => [] as ReviewRow[]);
}

const TZ = "Australia/Sydney";

/** "Tue 17 Jul" — short Sydney date, or null when there's nothing to show. */
function shortDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  try {
    return format(toZonedTime(value, TZ), "EEE d MMM");
  } catch {
    return null;
  }
}

/** "17 Jul · 14:32" — date + time for when the inspection was closed out. */
function dateTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  try {
    return format(toZonedTime(value, TZ), "d MMM · HH:mm");
  } catch {
    return null;
  }
}

export default async function QaReviewsPage() {
  const session = await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const reviews = await getReviews({ id: session.user.id, role: session.user.role as Role });
  // An inspection someone walked away from is the most actionable row here, so
  // it floats to the top regardless of when it was last touched.
  const ordered = [...reviews].sort((a, b) => {
    const rank = (r: ReviewRow) => (r.status === QaAssignmentStatus.IN_PROGRESS ? 0 : 1);
    return rank(a) - rank(b);
  });

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="History" title="Reviews" description="Completed and pending inspections." />
      {ordered.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="No reviews yet" description="Inspections will appear here as jobs are submitted." />
      ) : (
        <div className="space-y-3">
          {ordered.map((r) => {
            const propName = r.job?.property?.name ?? "Property";
            const suburb = r.job?.property?.suburb ?? "";
            const cleaner = r.job?.assignments[0]?.user?.name ?? "Unassigned";
            const jobId = r.job?.id ?? null;
            const isDone = r.status === QaAssignmentStatus.COMPLETED;
            // A started-but-unfinished inspection used to say "Start review",
            // which reads as "begin again" and hid the fact that there is work
            // waiting to be picked back up.
            const inProgress = r.status === QaAssignmentStatus.IN_PROGRESS;
            const jobDate = shortDate(r.job?.scheduledDate);
            const reviewedAt = dateTime(r.completedAt);
            const verdict = r.job?.qaReviews?.[0] ?? null;
            const inspector = r.assignedTo?.name ?? null;
            return (
              <ECard key={r.id}>
                <ECardBody className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.875rem] font-medium">{propName}{suburb ? `, ${suburb}` : ""}</p>
                    {/* Who + when, the two things a history row is useless without. */}
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {jobDate ? <span className="tabular-nums">{jobDate}</span> : null}
                      {jobDate ? " · " : ""}Cleaner: {cleaner}
                      {inspector ? ` · QA: ${inspector}` : ""}
                    </p>
                    {reviewedAt ? (
                      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                        Reviewed <span className="tabular-nums">{reviewedAt}</span>
                        {verdict?.cleanerAcknowledgedAt ? (
                          <span title={`Acknowledged ${dateTime(verdict.cleanerAcknowledgedAt) ?? ""}`}>
                            {" "}· Seen by cleaner
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  {/* The verdict — the whole point of a review. */}
                  {verdict?.score != null ? (
                    <EBadge tone={verdict.passed === false ? "danger" : "success"} soft>
                      {verdict.passed === false ? "Failed" : "Passed"} · {Math.round(verdict.score)}%
                    </EBadge>
                  ) : null}
                  {r.onSiteMinutes ? (
                    <span className="e-numeral text-[0.9375rem] tabular-nums">{r.onSiteMinutes}m</span>
                  ) : null}
                  <EBadge tone={statusTone(r.status)} soft>{titleCase(r.status)}</EBadge>
                  {jobId ? (
                    <EButton asChild variant={isDone ? "outline" : "gold"} size="sm"><Link href={`/v2/qa/jobs/${jobId}`}>
                        {/* A submitted inspection is not terminal — the workspace
                            offers "Reopen inspection" to whoever may amend it
                            (lib/qa/reopen.ts), so say so on the way in. */}
                        {isDone ? "Open / reopen" : inProgress ? "Continue review" : "Start review"}
                        <ChevronRight className="h-4 w-4" />
                      </Link></EButton>
                  ) : null}
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
    </div>
  );
}
