import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Unified Client-360 timeline: merges the client-level activity feed
 * (AuditLog + Notification — the same sources as the /activity route) with
 * per-job CLEANER UPDATES rolled up across the client's recent jobs
 * (assigned → en-route → arrived → clock in/out → completed → QA → report →
 * form submitted). Returns one reverse-chronological `items[]`.
 *
 * Each item: { id, type, title, detail, at (ISO), jobId?, jobNumber? }.
 * Read-only. ADMIN / OPS_MANAGER only.
 */

type TimelineType =
  | "AUDIT"
  | "MESSAGE"
  | "ASSIGNMENT"
  | "EN_ROUTE"
  | "ARRIVED"
  | "CLOCK_IN"
  | "CLOCK_OUT"
  | "COMPLETED"
  | "QA"
  | "REPORT"
  | "FORM";

interface TimelineItem {
  id: string;
  type: TimelineType;
  title: string;
  detail: string;
  at: string;
  jobId?: string;
  jobNumber?: string;
}

const MAX_ITEMS = 60;

function jobLabel(job: { jobNumber: string | null; property: { name: string | null } | null }): string {
  const parts = [job.property?.name, job.jobNumber ? `#${job.jobNumber}` : null].filter(Boolean);
  return parts.join(" · ") || "Job";
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const client = await db.client.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        email: true,
        users: { select: { id: true } },
        properties: { select: { id: true } },
      },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const userIds = client.users.map((u) => u.id);
    const propertyIds = client.properties.map((p) => p.id);

    const [auditRows, notifications, jobs] = await Promise.all([
      db.auditLog.findMany({
        where: {
          OR: [
            { entity: "Client", entityId: params.id },
            ...(userIds.length > 0 ? [{ entity: "User", entityId: { in: userIds } } as any] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 80,
        select: { id: true, action: true, entity: true, entityId: true, createdAt: true },
      }),
      userIds.length > 0
        ? db.notification.findMany({
            where: { userId: { in: userIds } },
            orderBy: { createdAt: "desc" },
            take: 80,
            select: { id: true, channel: true, subject: true, body: true, sentAt: true, createdAt: true },
          })
        : Promise.resolve([]),
      propertyIds.length > 0
        ? db.job.findMany({
            where: { propertyId: { in: propertyIds } },
            orderBy: { scheduledDate: "desc" },
            take: 20,
            select: {
              id: true,
              jobNumber: true,
              jobType: true,
              status: true,
              scheduledDate: true,
              enRouteStartedAt: true,
              arrivedAt: true,
              completedAt: true,
              property: { select: { name: true } },
              assignments: {
                where: { removedAt: null },
                select: {
                  id: true,
                  isPrimary: true,
                  assignedAt: true,
                  user: { select: { name: true, email: true } },
                },
              },
              timeLogs: {
                select: {
                  id: true,
                  startedAt: true,
                  stoppedAt: true,
                  durationM: true,
                  user: { select: { name: true, email: true } },
                },
              },
              qaReviews: {
                select: { id: true, passed: true, score: true, createdAt: true, notes: true },
              },
              report: { select: { id: true, sentToClient: true, sentAt: true, createdAt: true } },
              formSubmissions: {
                select: {
                  id: true,
                  createdAt: true,
                  submittedBy: { select: { name: true, email: true } },
                  media: { select: { id: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const items: TimelineItem[] = [];

    // ── Client-level activity ────────────────────────────────────────────
    for (const row of auditRows) {
      items.push({
        id: `audit-${row.id}`,
        type: "AUDIT",
        title: row.action.replace(/_/g, " "),
        detail: `${row.entity} record updated`,
        at: row.createdAt.toISOString(),
      });
    }
    for (const n of notifications) {
      items.push({
        id: `message-${n.id}`,
        type: "MESSAGE",
        title: n.subject?.trim() || `${n.channel} message`,
        detail: (n.body ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || n.channel,
        at: (n.sentAt ?? n.createdAt).toISOString(),
      });
    }

    // ── Per-job cleaner updates ──────────────────────────────────────────
    for (const job of jobs) {
      const label = jobLabel(job);

      for (const a of job.assignments) {
        const who = a.user.name ?? a.user.email ?? "Cleaner";
        items.push({
          id: `assign-${a.id}`,
          type: "ASSIGNMENT",
          title: a.isPrimary ? `${who} assigned (primary)` : `${who} assigned`,
          detail: label,
          at: a.assignedAt.toISOString(),
          jobId: job.id,
          jobNumber: job.jobNumber ?? undefined,
        });
      }

      if (job.enRouteStartedAt) {
        items.push({
          id: `enroute-${job.id}`,
          type: "EN_ROUTE",
          title: "Cleaner en route",
          detail: label,
          at: job.enRouteStartedAt.toISOString(),
          jobId: job.id,
          jobNumber: job.jobNumber ?? undefined,
        });
      }
      if (job.arrivedAt) {
        items.push({
          id: `arrived-${job.id}`,
          type: "ARRIVED",
          title: "Cleaner arrived on site",
          detail: label,
          at: job.arrivedAt.toISOString(),
          jobId: job.id,
          jobNumber: job.jobNumber ?? undefined,
        });
      }

      for (const log of job.timeLogs) {
        const who = log.user.name ?? log.user.email ?? "Cleaner";
        items.push({
          id: `clockin-${log.id}`,
          type: "CLOCK_IN",
          title: `${who} clocked in`,
          detail: label,
          at: log.startedAt.toISOString(),
          jobId: job.id,
          jobNumber: job.jobNumber ?? undefined,
        });
        if (log.stoppedAt) {
          const mins = Math.max(0, Number(log.durationM ?? 0));
          items.push({
            id: `clockout-${log.id}`,
            type: "CLOCK_OUT",
            title: `${who} clocked out`,
            detail: `${label} · ${mins} min on site`,
            at: log.stoppedAt.toISOString(),
            jobId: job.id,
            jobNumber: job.jobNumber ?? undefined,
          });
        }
      }

      if (job.completedAt) {
        items.push({
          id: `completed-${job.id}`,
          type: "COMPLETED",
          title: "Job completed",
          detail: label,
          at: job.completedAt.toISOString(),
          jobId: job.id,
          jobNumber: job.jobNumber ?? undefined,
        });
      }

      for (const qa of job.qaReviews) {
        items.push({
          id: `qa-${qa.id}`,
          type: "QA",
          title: qa.passed ? "QA passed" : "QA flagged rework",
          detail: `${label} · score ${qa.score}${qa.notes ? ` — ${qa.notes.replace(/\s+/g, " ").trim().slice(0, 120)}` : ""}`,
          at: qa.createdAt.toISOString(),
          jobId: job.id,
          jobNumber: job.jobNumber ?? undefined,
        });
      }

      if (job.report) {
        items.push({
          id: `report-${job.report.id}`,
          type: "REPORT",
          title: job.report.sentToClient ? "Report sent to client" : "Report generated",
          detail: label,
          at: (job.report.sentAt ?? job.report.createdAt).toISOString(),
          jobId: job.id,
          jobNumber: job.jobNumber ?? undefined,
        });
      }

      for (const sub of job.formSubmissions) {
        const who = sub.submittedBy?.name ?? sub.submittedBy?.email ?? "Cleaner";
        items.push({
          id: `form-${sub.id}`,
          type: "FORM",
          title: `${who} submitted report form`,
          detail: `${label}${sub.media.length ? ` · ${sub.media.length} photo${sub.media.length === 1 ? "" : "s"}` : ""}`,
          at: sub.createdAt.toISOString(),
          jobId: job.id,
          jobNumber: job.jobNumber ?? undefined,
        });
      }
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return NextResponse.json({
      client: { id: client.id, name: client.name, email: client.email },
      items: items.slice(0, MAX_ITEMS),
    });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load timeline." }, { status });
  }
}
