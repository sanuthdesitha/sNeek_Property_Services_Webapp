import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * QA-PERFORMANCE dashboard (ADMIN / OPS_MANAGER).
 *
 * Per QA inspector (users with QA_INSPECTOR role + anyone who raised QaIssues in
 * the window): inspections completed, on-site time, issues found by severity,
 * issues they fixed themselves, rectification minutes/cost, false-confirmation
 * flags raised, and the CAUTION metric — complaint rate on jobs they QA-passed
 * that later drew low client feedback (possible missed issues).
 *
 * The scoring philosophy (rendered on the dashboard): issue *quantity* alone is
 * not rewarded — it balances found vs fix quality vs misses.
 *
 * ?period=7d|30d|90d (default 30d). Scale is tiny; all queries are grouped/IN.
 */

const SEVERITY_KEYS = ["MINOR", "MAJOR", "CRITICAL"] as const;
type SeverityKey = (typeof SEVERITY_KEYS)[number];

const SCORING_NOTE =
  "Issue quantity alone is not rewarded — balance found vs fix quality vs misses.";

function periodToDays(period: string | null): { key: string; days: number } {
  switch (period) {
    case "7d":
      return { key: "7d", days: 7 };
    case "90d":
      return { key: "90d", days: 90 };
    default:
      return { key: "30d", days: 30 };
  }
}

export async function GET(req: Request) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const { key: period, days } = periodToDays(new URL(req.url).searchParams.get("period"));
    const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [inspectorUsers, raisers, assignments, issues, passedReviews] = await Promise.all([
      db.user
        .findMany({
          where: { role: Role.QA_INSPECTOR, isActive: true },
          select: { id: true, name: true, role: true },
        })
        .catch(() => [] as { id: string; name: string | null; role: Role }[]),
      // Anyone who raised issues in the window (may not carry the QA role).
      db.qaIssue
        .findMany({
          where: { createdAt: { gte: windowStart } },
          select: { raisedById: true, raisedBy: { select: { name: true, role: true } } },
          distinct: ["raisedById"],
        })
        .catch(() => [] as { raisedById: string; raisedBy: { name: string | null; role: Role } | null }[]),
      db.qaAssignment
        .findMany({
          where: { status: "COMPLETED" as any, completedAt: { gte: windowStart } },
          select: { assignedToId: true, onSiteMinutes: true },
        })
        .catch(() => [] as { assignedToId: string | null; onSiteMinutes: number | null }[]),
      db.qaIssue
        .findMany({
          where: { createdAt: { gte: windowStart } },
          select: {
            raisedById: true,
            severity: true,
            falseConfirmation: true,
            rectificationStatus: true,
            rectifiedById: true,
            rectificationMinutes: true,
            rectificationCost: true,
          },
        })
        .catch(() => [] as any[]),
      // QA-authority passing reviews in the window, with the client-feedback
      // signals we use to flag possible misses.
      db.qAReview
        .findMany({
          where: { createdAt: { gte: windowStart }, kind: "QA", passed: true, reviewedById: { not: null } },
          select: {
            reviewedById: true,
            job: {
              select: {
                feedback: { select: { rating: true } },
                satisfactionRating: { select: { score: true } },
              },
            },
          },
        })
        .catch(() => [] as any[]),
    ]);

    // ── Build the inspector roster (QA role ∪ issue raisers) ───────────────
    type Insp = {
      inspectorId: string;
      name: string;
      role: string;
      inspectionsCompleted: number;
      onSiteMinutesSum: number;
      onSiteN: number;
      issuesFound: Record<SeverityKey, number> & { total: number };
      issuesFixedByQA: number;
      rectificationMinutes: number;
      rectificationCost: number;
      falseConfirmationsRaised: number;
      passedJobs: number;
      complaints: number;
    };
    const roster = new Map<string, Insp>();
    const ensure = (id: string, name: string | null | undefined, role: string) => {
      let r = roster.get(id);
      if (!r) {
        r = {
          inspectorId: id,
          name: name ?? "Inspector",
          role,
          inspectionsCompleted: 0,
          onSiteMinutesSum: 0,
          onSiteN: 0,
          issuesFound: { MINOR: 0, MAJOR: 0, CRITICAL: 0, total: 0 },
          issuesFixedByQA: 0,
          rectificationMinutes: 0,
          rectificationCost: 0,
          falseConfirmationsRaised: 0,
          passedJobs: 0,
          complaints: 0,
        };
        roster.set(id, r);
      }
      return r;
    };

    for (const u of inspectorUsers) ensure(u.id, u.name, u.role);
    for (const r of raisers) {
      if (!r.raisedById) continue;
      ensure(r.raisedById, r.raisedBy?.name, r.raisedBy?.role ?? "—");
    }

    // ── Inspections completed + on-site time ───────────────────────────────
    for (const a of assignments) {
      if (!a.assignedToId) continue;
      const r = roster.get(a.assignedToId);
      if (!r) continue; // completed by a non-QA-role, non-raiser user — skip
      r.inspectionsCompleted += 1;
      if (typeof a.onSiteMinutes === "number") {
        r.onSiteMinutesSum += a.onSiteMinutes;
        r.onSiteN += 1;
      }
    }

    // ── Issues found / fixed / false-conf / rectification totals ───────────
    for (const i of issues as any[]) {
      if (i.raisedById) {
        const r = roster.get(i.raisedById);
        if (r) {
          if ((SEVERITY_KEYS as readonly string[]).includes(i.severity)) {
            r.issuesFound[i.severity as SeverityKey] += 1;
          }
          r.issuesFound.total += 1;
          if (i.falseConfirmation === "SUSPECTED" || i.falseConfirmation === "CONFIRMED") {
            r.falseConfirmationsRaised += 1;
          }
        }
      }
      if (i.rectificationStatus === "FIXED_BY_QA" && i.rectifiedById) {
        const r = roster.get(i.rectifiedById);
        if (r) {
          r.issuesFixedByQA += 1;
          r.rectificationMinutes += i.rectificationMinutes ?? 0;
          r.rectificationCost += i.rectificationCost ?? 0;
        }
      }
    }

    // ── CAUTION: complaint rate on QA-passed jobs ──────────────────────────
    for (const rv of passedReviews as any[]) {
      const id = rv.reviewedById as string | null;
      if (!id) continue;
      const r = roster.get(id);
      if (!r) continue;
      r.passedJobs += 1;
      const fb = rv.job?.feedback?.rating;
      const sat = rv.job?.satisfactionRating?.score;
      if ((typeof fb === "number" && fb <= 2) || (typeof sat === "number" && sat <= 2)) {
        r.complaints += 1;
      }
    }

    const inspectors = Array.from(roster.values())
      .map((r) => ({
        inspectorId: r.inspectorId,
        name: r.name,
        role: r.role,
        inspectionsCompleted: r.inspectionsCompleted,
        avgOnSiteMinutes: r.onSiteN > 0 ? Math.round(r.onSiteMinutesSum / r.onSiteN) : null,
        issuesFound: r.issuesFound,
        issuesFixedByQA: r.issuesFixedByQA,
        rectificationMinutes: r.rectificationMinutes,
        rectificationCost: Math.round(r.rectificationCost * 100) / 100,
        falseConfirmationsRaised: r.falseConfirmationsRaised,
        caution: {
          passedJobs: r.passedJobs,
          complaints: r.complaints,
          complaintRate:
            r.passedJobs > 0 ? Math.round((r.complaints / r.passedJobs) * 1000) / 10 : null,
        },
      }))
      .sort((a, b) => b.issuesFound.total - a.issuesFound.total || b.inspectionsCompleted - a.inspectionsCompleted);

    return NextResponse.json({
      period,
      windowStart: windowStart.toISOString(),
      generatedAt: new Date().toISOString(),
      note: SCORING_NOTE,
      inspectors,
    });
  } catch (err: any) {
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: err?.message ?? "Could not load QA performance." },
      { status },
    );
  }
}
