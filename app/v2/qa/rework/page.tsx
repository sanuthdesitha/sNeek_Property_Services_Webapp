import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { QaReworkSeverity, QaReworkTransferStatus, Role } from "@prisma/client";
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  officeAlsoInspects,
  resolveReworkScope,
  reworkProgress,
  reworkScopeWhere,
  type ReworkProgressKey,
  type ReworkScope,
  type ReworkViewer,
} from "@/lib/qa/rework-list";
import { EAlert, EBadge, ECard, ECardBody, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Rework · Estate QA" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function severityTone(sev: QaReworkSeverity): Tone {
  switch (sev) {
    case QaReworkSeverity.MAJOR:
      return "danger";
    case QaReworkSeverity.MODERATE:
      return "warning";
    default:
      return "info";
  }
}

/** Board wording: open work waits; a decision closes it. */
const STATUS_LABEL: Record<QaReworkTransferStatus, string> = {
  [QaReworkTransferStatus.PENDING]: "Waiting for approval",
  [QaReworkTransferStatus.APPROVED]: "Closed · approved",
  [QaReworkTransferStatus.REJECTED]: "Closed · rejected",
};

function statusTone(status: QaReworkTransferStatus): Tone {
  switch (status) {
    case QaReworkTransferStatus.APPROVED:
      return "success";
    case QaReworkTransferStatus.REJECTED:
      return "neutral";
    default:
      return "warning";
  }
}

type ReworkRow = {
  id: string;
  severity: QaReworkSeverity;
  status: QaReworkTransferStatus;
  reason: string;
  areas: unknown;
  createdAt: Date;
  minutesFromCleaner: number | null;
  amountFromCleaner: number | null;
  cleaner: { name: string | null } | null;
  assignment: { reworkOfferStatus: string | null; reworkOfferExpiresAt: Date | null } | null;
  job: {
    id: string;
    scheduledDate: Date | null;
    property: { name: string | null; suburb: string | null } | null;
    reworkChildren: { status: string }[];
  } | null;
};

/** Scoped in the query (lib/qa/rework-list.ts): an inspector never receives others' rows. */
async function getRework(viewer: ReworkViewer, scope: ReworkScope): Promise<ReworkRow[] | null> {
  return db.qaReworkTransfer
    .findMany({
      where: reworkScopeWhere(viewer, scope),
      orderBy: [{ createdAt: "desc" }],
      take: 30,
      select: {
        id: true,
        severity: true,
        status: true,
        reason: true,
        areas: true,
        // The list was ORDERED by createdAt but never showed it, and hid the
        // time/pay being moved off the cleaner — the figures that make a rework
        // row reviewable.
        createdAt: true,
        minutesFromCleaner: true,
        amountFromCleaner: true,
        cleaner: { select: { name: true } },
        assignment: { select: { reworkOfferStatus: true, reworkOfferExpiresAt: true } },
        job: {
          select: {
            id: true,
            scheduledDate: true,
            property: { select: { name: true, suburb: true } },
            // Offer-back progress: the rework clean raised from this job.
            reworkChildren: {
              where: { isRework: true },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { status: true },
            },
          },
        },
      },
    })
    // A failed read is not "nothing flagged": the page says it is unavailable.
    .catch(() => null);
}

const TZ = "Australia/Sydney";

function shortDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  try {
    return format(toZonedTime(value, TZ), "EEE d MMM");
  } catch {
    return null;
  }
}

function dateTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  try {
    return format(toZonedTime(value, TZ), "d MMM · HH:mm");
  } catch {
    return null;
  }
}

function areaSummary(areas: unknown): string | null {
  if (Array.isArray(areas) && areas.length > 0) {
    return areas.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" · ");
  }
  return null;
}

const PROGRESS_TONE: Record<ReworkProgressKey, Tone> = {
  WAITING: "warning",
  IN_PROGRESS: "info",
  DONE: "success",
  OFFER_DECLINED: "neutral",
  OFFER_EXPIRED: "neutral",
};

const SCOPE_CHIP =
  "inline-flex min-h-11 items-center rounded-[var(--e-radius-pill)] border px-4 text-[0.8125rem] font-[550] focus-visible:outline focus-visible:outline-2";

function ScopeChips({ scope }: { scope: ReworkScope }) {
  const chips: { value: ReworkScope; label: string }[] = [
    { value: "mine", label: "Mine" },
    { value: "all", label: "All" },
  ];
  return (
    <nav aria-label="Whose rework" className="flex gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.value}
          href={`/v2/qa/rework?scope=${chip.value}`}
          aria-current={scope === chip.value ? "page" : undefined}
          className={`${SCOPE_CHIP} ${
            scope === chip.value
              ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
              : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))]"
          }`}
        >
          {chip.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function QaReworkPage({ searchParams }: { searchParams?: { scope?: string } }) {
  const session = await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const viewer: ReworkViewer = {
    id: session.user.id,
    role: session.user.role,
    heldRoles: session.user.heldRoles ?? null,
  };
  const scope = resolveReworkScope(viewer, searchParams?.scope);
  const flagged = await getRework(viewer, scope);
  const open = flagged?.filter((f) => f.status === QaReworkTransferStatus.PENDING).length ?? null;
  const description =
    scope === "mine"
      ? "Rework from your inspections and rework handed to you, newest first. Time and pay moved off a cleaner wait for the office's approval."
      : "Areas flagged for correction across the team, newest first. Time and pay moved off a cleaner wait for the office's approval.";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <EPageHeader
        eyebrow="Follow-up"
        title="Rework"
        description={description}
        actions={open !== null && open > 0 ? <EBadge tone="warning" soft>{open} open</EBadge> : undefined}
      />
      {officeAlsoInspects(viewer) ? <ScopeChips scope={scope} /> : null}
      {flagged === null ? (
        <div role="alert">
          <EAlert tone="danger" title="Rework is unavailable right now.">
            <a href={`/v2/qa/rework?scope=${scope}`} className="font-[550] underline underline-offset-2">Retry</a>
          </EAlert>
        </div>
      ) : flagged.length === 0 ? (
        <EEmptyState
          eyebrow="All clear"
          title="Nothing flagged"
          description={scope === "mine" ? "No rework from your inspections or handed to you." : "No rework has been raised."}
        />
      ) : (
        <div className="space-y-3">
          {flagged.map((f) => {
            const propName = f.job?.property?.name ?? "Property";
            const suburb = f.job?.property?.suburb ?? "";
            const areas = areaSummary(f.areas);
            const jobDate = shortDate(f.job?.scheduledDate);
            const raisedAt = dateTime(f.createdAt);
            const progress = reworkProgress({
              offerStatus: f.assignment?.reworkOfferStatus ?? null,
              offerExpiresAt: f.assignment?.reworkOfferExpiresAt ?? null,
              reworkJobs: f.job?.reworkChildren ?? [],
            });
            return (
              <ECard key={f.id}>
                <ECardBody className="space-y-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[0.875rem] font-medium">{propName}{suburb ? `, ${suburb}` : ""}</p>
                    <div className="flex items-center gap-2">
                      <EBadge tone={severityTone(f.severity)} soft>{titleCase(f.severity)}</EBadge>
                      <EBadge tone={statusTone(f.status)} soft>{STATUS_LABEL[f.status] ?? titleCase(f.status)}</EBadge>
                    </div>
                  </div>
                  {progress ? (
                    <p className="flex flex-wrap items-center gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <EBadge tone={PROGRESS_TONE[progress.key]} soft>{progress.label}</EBadge>
                      {progress.detail ? <span>{progress.detail}</span> : null}
                    </p>
                  ) : null}
                  {areas ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{areas}</p> : null}
                  <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{f.reason}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Cleaner: {f.cleaner?.name ?? "Unassigned"}
                    {jobDate ? <> · Job <span className="tabular-nums">{jobDate}</span></> : null}
                    {raisedAt ? <> · Raised <span className="tabular-nums">{raisedAt}</span></> : null}
                  </p>
                  {/* What is actually being moved off the cleaner — pending until
                      an admin approves it in the Approval Center. */}
                  {f.minutesFromCleaner || f.amountFromCleaner ? (
                    <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-foreground))]">
                      {f.minutesFromCleaner ? <span className="tabular-nums">{f.minutesFromCleaner} min</span> : null}
                      {f.minutesFromCleaner && f.amountFromCleaner ? " · " : ""}
                      {f.amountFromCleaner ? (
                        <span className="tabular-nums">${f.amountFromCleaner.toFixed(2)}</span>
                      ) : null}
                      <span className="font-normal text-[hsl(var(--e-muted-foreground))]"> from cleaner</span>
                    </p>
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
