import { db } from "@/lib/db";
import type { CaseAutomationSettings, CaseSeverityLevel } from "@/lib/settings";
import type { CaseState } from "@/lib/cases/lifecycle-fsm";

/**
 * Central rules for *automated* case creation. The platform detects a lot of
 * minor breaches (slightly overdue jobs, soft SLA misses). We do not want every
 * one of those to spawn a formal case — that floods the queue and trains users
 * to ignore it. These helpers gate auto-creation on a configurable severity
 * threshold + grace window, dedupe against existing open cases, and self-heal
 * (auto-resolve) when the underlying condition clears.
 */

const SEVERITY_RANK: Record<CaseSeverityLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function normalizeSeverity(value: string | null | undefined): CaseSeverityLevel {
  const v = String(value ?? "").trim().toUpperCase();
  if (v === "LOW" || v === "MEDIUM" || v === "HIGH" || v === "CRITICAL") return v;
  return "MEDIUM";
}

/**
 * Does this breach severity reach the configured threshold for opening a formal
 * case? Below the threshold the breach should surface only as a soft attention
 * item (immediate-attention panels / dashboards), never a case.
 */
export function meetsAutoOpenThreshold(
  severity: string | null | undefined,
  automation: CaseAutomationSettings
): boolean {
  return SEVERITY_RANK[normalizeSeverity(severity)] >= SEVERITY_RANK[automation.autoOpenMinSeverity];
}

/**
 * Total minutes a job must be overdue before an automated *case* is opened:
 * the SLA escalation window plus the configured grace. (Escalation/notification
 * can still happen earlier — this only governs formal case creation.)
 */
export function overdueCaseThresholdMinutes(
  slaOverdueEscalationMinutes: number,
  automation: CaseAutomationSettings
): number {
  return Math.max(0, slaOverdueEscalationMinutes) + Math.max(0, automation.overdueGraceMinutes);
}

/**
 * Find an existing open (not RESOLVED/CLOSED) auto-case for a job, optionally
 * scoped by case type and/or a title prefix. Used everywhere auto-cases are
 * created so we never open a duplicate.
 */
export async function findOpenAutoCase(opts: {
  jobId: string;
  caseType?: string;
  titlePrefix?: string;
}): Promise<{ id: string; state: CaseState } | null> {
  const row = await db.issueTicket.findFirst({
    where: {
      jobId: opts.jobId,
      ...(opts.caseType ? { caseType: opts.caseType } : {}),
      ...(opts.titlePrefix
        ? { title: { startsWith: opts.titlePrefix } }
        : {}),
      status: { notIn: ["RESOLVED", "CLOSED"] },
    },
    select: { id: true, state: true },
    orderBy: { createdAt: "desc" },
  });
  return row ? { id: row.id, state: row.state as CaseState } : null;
}

/**
 * Self-heal: auto-resolve an auto-created case whose underlying condition has
 * cleared. Sets the legacy status to RESOLVED, moves the lifecycle state to
 * RESOLVED, records a CaseTransition note, and adds an internal comment so the
 * timeline shows *why* it closed. Best-effort and idempotent (no-op if already
 * resolved). Honours the autoResolveOnClear setting at the call site.
 */
export async function autoResolveCase(opts: {
  caseId: string;
  reason: string;
  actorId?: string | null;
}): Promise<boolean> {
  const existing = await db.issueTicket.findUnique({
    where: { id: opts.caseId },
    select: { id: true, status: true, state: true },
  });
  if (!existing) return false;
  if (existing.status === "RESOLVED" || existing.status === "CLOSED") return false;

  const fromState = (existing.state as CaseState) ?? "OPEN";
  const ops: any[] = [
    db.issueTicket.update({
      where: { id: opts.caseId },
      data: {
        status: "RESOLVED",
        state: "RESOLVED",
        resolutionNote: opts.reason.slice(0, 4000),
      },
    }),
    db.caseTransition.create({
      data: {
        caseId: opts.caseId,
        fromState,
        toState: "RESOLVED",
        actorId: opts.actorId ?? null,
        reason: opts.reason.slice(0, 4000),
      },
    }),
  ];
  // CaseComment requires an author; only leave a timeline note when the
  // self-heal was triggered by a known actor (e.g. the QA reviewer / system
  // admin). The transition above always records the resolution regardless.
  if (opts.actorId) {
    ops.push(
      db.caseComment.create({
        data: {
          caseId: opts.caseId,
          authorUserId: opts.actorId,
          isInternal: true,
          body: `Auto-resolved by the system: ${opts.reason}`.slice(0, 4000),
        },
      })
    );
  }
  await db.$transaction(ops);
  return true;
}

/**
 * Resolve every open auto-case attached to a job (optionally scoped by type /
 * title prefix). Returns how many were healed. Used when a job is completed or
 * passes QA on re-review.
 */
export async function autoResolveJobCases(opts: {
  jobId: string;
  caseType?: string;
  titlePrefix?: string;
  reason: string;
  actorId?: string | null;
}): Promise<number> {
  const rows = await db.issueTicket.findMany({
    where: {
      jobId: opts.jobId,
      ...(opts.caseType ? { caseType: opts.caseType } : {}),
      ...(opts.titlePrefix ? { title: { startsWith: opts.titlePrefix } } : {}),
      status: { notIn: ["RESOLVED", "CLOSED"] },
      // Only heal cases the system opened — never touch human-filed cases.
      source: { in: ["SLA_AUTOMATION", "QA_AUTOMATION", "COMMERCIAL_SLA"] },
    },
    select: { id: true },
  });
  let healed = 0;
  for (const row of rows) {
    const ok = await autoResolveCase({
      caseId: row.id,
      reason: opts.reason,
      actorId: opts.actorId,
    }).catch(() => false);
    if (ok) healed += 1;
  }
  return healed;
}
