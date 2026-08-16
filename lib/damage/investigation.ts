/**
 * D2 — the damage investigation view model, for admin and for the client.
 *
 * One assembler serves both audiences because the alternative — two queries
 * shaped separately — is how a field ends up visible to a client on one screen
 * and hidden on another. The audience is a parameter, and the redaction happens
 * in ONE place that is unit-tested directly.
 *
 * Two things the client must never receive, both enforced here rather than by
 * the templates that render them:
 *
 *   1. `estimatedCost` — admin/QA decide repair cost; a client seeing a working
 *      figure would treat it as a quote. Nulled for CLIENT, not merely hidden,
 *      so it is absent from the JSON payload the browser can read.
 *   2. Transition reasons, which carry internal triage notes.
 *
 * Status is read live from CP-7 rather than copied onto the damage row: the
 * case and its maintenance item keep each other in sync
 * (lib/cases/damage-maintenance-sync.ts), so the investigation page reflects
 * whatever the repair is actually doing instead of a snapshot taken at submit.
 */

import { DamageReportStatus, type DamageSeverity } from "@prisma/client";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { highestDamageSeverity } from "@/lib/damage/severity";

export type DamageAudience = "ADMIN" | "CLIENT";

export interface DamageInvestigationPhoto {
  id: string;
  url: string;
  caption: string | null;
  section: string;
  /** True when the displayed image carries the cleaner's markup. */
  annotated: boolean;
}

export interface DamageInvestigationTransition {
  id: string;
  fromState: string | null;
  toState: string;
  actorName: string | null;
  reason: string | null;
  occurredAt: Date;
}

export interface DamageInvestigationMaintenance {
  id: string;
  title: string;
  status: string;
  priority: string;
  scheduledFor: Date | null;
  resolvedAt: Date | null;
  assignedWorkerName: string | null;
}

export interface DamageInvestigationItem {
  id: string;
  area: string;
  category: string;
  severity: DamageSeverity;
  description: string;
  suspectedCause: string;
  /** ADMIN only. Always null for CLIENT. */
  estimatedCost: number | null;
  photos: DamageInvestigationPhoto[];
  caseId: string | null;
  caseState: string | null;
  caseStatus: string | null;
  transitions: DamageInvestigationTransition[];
  maintenance: DamageInvestigationMaintenance[];
}

export interface DamageInvestigation {
  id: string;
  status: DamageReportStatus;
  submittedAt: Date | null;
  clientVisible: boolean;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reportedByName: string | null;
  jobId: string;
  propertyId: string;
  propertyName: string | null;
  highestSeverity: DamageSeverity | null;
  items: DamageInvestigationItem[];
}

/** Everything both audiences need, fetched once. */
const INVESTIGATION_INCLUDE = {
  reportedBy: { select: { name: true, email: true } },
  reviewedBy: { select: { name: true, email: true } },
  property: { select: { id: true, name: true } },
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      photos: { orderBy: { createdAt: "asc" } },
      case: {
        include: {
          transitions: {
            orderBy: { occurredAt: "asc" },
            include: { actor: { select: { name: true, email: true } } },
          },
          maintenanceItems: {
            include: { assignedWorker: { select: { name: true } } },
          },
        },
      },
    },
  },
} as const;

function personName(person: { name?: string | null; email?: string | null } | null): string | null {
  if (!person) return null;
  return person.name?.trim() || person.email?.trim() || null;
}

/**
 * Shape one loaded report for one audience.
 *
 * Exported so the redaction can be tested without a database — the rule that
 * matters (a client never receives a cost) should not depend on a live query
 * to prove.
 */
export function toInvestigationViewModel(row: any, audience: DamageAudience): DamageInvestigation {
  const isAdmin = audience === "ADMIN";

  const items: DamageInvestigationItem[] = (row.items ?? []).map((item: any) => ({
    id: item.id,
    area: item.area,
    category: item.category,
    severity: item.severity,
    description: item.description,
    suspectedCause: item.suspectedCause,
    // Nulled rather than omitted so the field's absence is explicit and typed.
    estimatedCost: isAdmin ? (item.estimatedCost ?? null) : null,
    photos: (item.photos ?? []).map((photo: any) => ({
      id: photo.id,
      // The flattened composite when one exists, else the original. NEVER the
      // bare overlay — on transparency it renders as a black tile.
      url: publicUrl(photo.flatKey || photo.s3Key),
      caption: photo.caption ?? null,
      section: photo.section,
      annotated: Boolean(photo.flatKey || photo.annotatedKey),
    })),
    caseId: item.case?.id ?? null,
    caseState: item.case?.state ?? null,
    caseStatus: item.case?.status ?? null,
    transitions: (item.case?.transitions ?? []).map((t: any) => ({
      id: t.id,
      fromState: t.fromState ?? null,
      toState: t.toState,
      actorName: personName(t.actor),
      // A transition reason can carry internal triage notes.
      reason: isAdmin ? (t.reason ?? null) : null,
      occurredAt: t.occurredAt,
    })),
    maintenance: (item.case?.maintenanceItems ?? []).map((m: any) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      priority: m.priority,
      scheduledFor: m.scheduledFor ?? null,
      resolvedAt: m.resolvedAt ?? null,
      assignedWorkerName: m.assignedWorker?.name ?? null,
    })),
  }));

  return {
    id: row.id,
    status: row.status,
    submittedAt: row.submittedAt ?? null,
    clientVisible: row.clientVisible,
    reviewedAt: row.reviewedAt ?? null,
    reviewedByName: isAdmin ? personName(row.reviewedBy) : null,
    reportedByName: personName(row.reportedBy),
    jobId: row.jobId,
    propertyId: row.propertyId,
    propertyName: row.property?.name ?? null,
    highestSeverity: highestDamageSeverity(items.map((item) => item.severity)),
    items,
  };
}

/** Admin view: any report, released or not, costs included. */
export async function getDamageInvestigationForAdmin(
  reportId: string
): Promise<DamageInvestigation | null> {
  const row = await db.damageReport.findUnique({
    where: { id: reportId },
    include: INVESTIGATION_INCLUDE,
  });
  return row ? toInvestigationViewModel(row, "ADMIN") : null;
}

/**
 * Client view, scoped to the client's own property and gated on release.
 *
 * The clientId is matched in the QUERY rather than checked afterwards, so a
 * client asking for another client's report id gets the same "not found" as
 * one asking for a report that does not exist — no existence oracle.
 *
 * A DRAFT is excluded even if clientVisible were somehow true: an unsubmitted
 * report is a cleaner's working notes, not a finding.
 */
export async function getDamageInvestigationForClient(input: {
  reportId: string;
  clientId: string;
}): Promise<DamageInvestigation | null> {
  const row = await db.damageReport.findFirst({
    where: {
      id: input.reportId,
      clientVisible: true,
      status: {
        in: [
          DamageReportStatus.SUBMITTED,
          DamageReportStatus.UNDER_REVIEW,
          DamageReportStatus.CLOSED,
        ],
      },
      property: { clientId: input.clientId },
    },
    include: INVESTIGATION_INCLUDE,
  });
  return row ? toInvestigationViewModel(row, "CLIENT") : null;
}
