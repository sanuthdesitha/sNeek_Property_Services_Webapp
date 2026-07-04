import Link from "next/link";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
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
  job: {
    id: string;
    property: { name: string | null; suburb: string | null } | null;
    assignments: { user: { name: string | null } | null }[];
  } | null;
};

async function getReviews(): Promise<ReviewRow[]> {
  return db.qaAssignment
    .findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 30,
      select: {
        id: true,
        status: true,
        onSiteMinutes: true,
        job: {
          select: {
            id: true,
            property: { select: { name: true, suburb: true } },
            assignments: { select: { user: { select: { name: true } } }, take: 1 },
          },
        },
      },
    })
    .catch(() => [] as ReviewRow[]);
}

export default async function QaReviewsPage() {
  await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const reviews = await getReviews();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="History" title="Reviews" description="Completed and pending inspections." />
      {reviews.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="No reviews yet" description="Inspections will appear here as jobs are submitted." />
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => {
            const propName = r.job?.property?.name ?? "Property";
            const suburb = r.job?.property?.suburb ?? "";
            const cleaner = r.job?.assignments[0]?.user?.name ?? "Unassigned";
            const jobId = r.job?.id ?? null;
            const isDone = r.status === QaAssignmentStatus.COMPLETED;
            return (
              <ECard key={r.id}>
                <ECardBody className="flex items-center gap-3 pt-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.875rem] font-medium">{propName}{suburb ? `, ${suburb}` : ""}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{cleaner}</p>
                  </div>
                  {r.onSiteMinutes ? <span className="e-numeral text-[0.9375rem]">{r.onSiteMinutes}m</span> : null}
                  <EBadge tone={statusTone(r.status)} soft>{titleCase(r.status)}</EBadge>
                  {jobId ? (
                    <Link href={`/qa/jobs/${jobId}`}>
                      <EButton variant={isDone ? "outline" : "gold"} size="sm">
                        {isDone ? "Open" : "Start review"}
                        <ChevronRight className="h-4 w-4" />
                      </EButton>
                    </Link>
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
