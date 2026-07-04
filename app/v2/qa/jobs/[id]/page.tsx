import Link from "next/link";
import { notFound } from "next/navigation";
import { JobStatus, QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EThread,
} from "@/components/v2/ui/primitives";
import { ClipboardCheck, MapPin, Star, User } from "lucide-react";

export const metadata = { title: "Review · Estate QA" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function jobStatusTone(status: JobStatus): Tone {
  switch (status) {
    case JobStatus.SUBMITTED:
    case JobStatus.QA_REVIEW:
      return "primary";
    case JobStatus.COMPLETED:
    case JobStatus.INVOICED:
      return "success";
    case JobStatus.IN_PROGRESS:
    case JobStatus.EN_ROUTE:
      return "info";
    default:
      return "neutral";
  }
}

// Read summary sourced the same way as GET /api/qa/jobs/[id] (db.job by id, with
// property + roster + latest QA review). The heavy inspection workspace is the
// live client page at /qa/jobs/[id]; we link to it rather than re-implement it.
export default async function QaJobReviewPage({ params }: { params: { id: string } }) {
  await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);

  const job = await db.job
    .findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        jobType: true,
        property: { select: { name: true, suburb: true, address: true } },
        assignments: {
          where: { removedAt: null },
          select: { user: { select: { name: true } } },
        },
        qaReviews: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { score: true, passed: true, createdAt: true },
        },
        qaAssignments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, dueAt: true },
        },
      },
    })
    .catch(() => null);

  if (!job) notFound();

  const propName = job.property?.name ?? "Property";
  const suburb = job.property?.suburb ?? "";
  const address = job.property?.address ?? "";
  const cleaners = job.assignments.map((a) => a.user?.name).filter(Boolean) as string[];
  const latestReview = job.qaReviews[0] ?? null;
  const assignmentStatus = job.qaAssignments[0]?.status ?? null;
  const inProgress = assignmentStatus === QaAssignmentStatus.IN_PROGRESS;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Quality assurance"
        title={`${propName}${suburb ? `, ${suburb}` : ""}`}
        description={`${titleCase(job.jobType)} · QA inspection`}
        actions={
          <Link href={`/qa/jobs/${job.id}`}>
            <EButton variant="gold">{inProgress ? "Continue review" : "Open review workspace"}</EButton>
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <ECard className="p-5">
          <div className="flex items-start justify-between">
            <p className="e-eyebrow">Job status</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
              <ClipboardCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <EBadge tone={jobStatusTone(job.status)} soft>{titleCase(job.status)}</EBadge>
          </div>
        </ECard>

        <ECard className="p-5">
          <div className="flex items-start justify-between">
            <p className="e-eyebrow">Latest QA score</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
              <Star className="h-4 w-4" />
            </span>
          </div>
          <p className="e-numeral mt-2 text-[1.75rem] leading-none">
            {latestReview ? `${Math.round(latestReview.score)}%` : "—"}
          </p>
          {latestReview ? (
            <p className="mt-1.5 text-[0.8125rem] font-medium" style={{ color: latestReview.passed ? "hsl(var(--e-success))" : "hsl(var(--e-danger))" }}>
              {latestReview.passed ? "Passed" : "Failed"}
            </p>
          ) : (
            <p className="mt-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Not yet inspected</p>
          )}
        </ECard>

        <ECard className="p-5">
          <div className="flex items-start justify-between">
            <p className="e-eyebrow">Cleaner</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
              <User className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 text-[0.9375rem] font-medium">
            {cleaners.length ? cleaners.join(", ") : "Unassigned"}
          </p>
        </ECard>
      </section>

      <ECard>
        <ECardHeader><ECardTitle>Property</ECardTitle></ECardHeader>
        <ECardBody className="space-y-3">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-[hsl(var(--e-muted-foreground))]" />
            <div>
              <p className="text-[0.875rem] font-medium">{propName}</p>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {[address, suburb].filter(Boolean).join(", ") || "Address on file"}
              </p>
            </div>
          </div>
          <EThread />
          <EAlert tone="info" title="Full inspection lives in the workspace">
            Scoring, photo review, damage reports, restock, rework and sign-off run in the live QA
            review workspace. Open it to complete the inspection.
          </EAlert>
          <div>
            <Link href={`/qa/jobs/${job.id}`}>
              <EButton variant="gold">{inProgress ? "Continue review" : "Open review workspace"}</EButton>
            </Link>
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
