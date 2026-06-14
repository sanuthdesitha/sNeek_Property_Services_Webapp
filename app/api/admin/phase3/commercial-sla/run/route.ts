import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { evaluateCommercialSla } from "@/lib/phase3/commercial-sla";
import { getAppSettings } from "@/lib/settings";
import { meetsAutoOpenThreshold } from "@/lib/cases/auto-case";

const schema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  branchId: z.string().trim().optional().nullable(),
  createIssues: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const result = await evaluateCommercialSla({
      startDate: body.startDate,
      endDate: body.endDate,
      branchId: body.branchId ?? null,
    });

    let issuesCreated = 0;
    if (body.createIssues) {
      const settings = await getAppSettings();
      for (const breach of result.breaches) {
        // THRESHOLD: keep minor commercial breaches out of the formal queue.
        if (!meetsAutoOpenThreshold(breach.severity, settings.caseAutomation)) continue;
        // DEDUPE: never open a second open case for this job + rule.
        const existing = await db.issueTicket.findFirst({
          where: {
            jobId: breach.jobId,
            title: `SLA breach (${breach.ruleName})`,
            status: { notIn: ["RESOLVED", "CLOSED"] },
          },
          select: { id: true },
        });
        if (existing) continue;
        await db.issueTicket.create({
          data: {
            jobId: breach.jobId,
            title: `SLA breach (${breach.ruleName})`,
            description: `Types: ${breach.breachTypes.join(", ")} | Severity: ${breach.severity}`,
            severity: breach.severity,
            status: "OPEN",
            state: "OPEN",
            caseType: "SLA",
            source: "COMMERCIAL_SLA",
          },
        });
        issuesCreated += 1;
      }
    }

    if (result.breaches.length > 0) {
      await db.notification.create({
        data: {
          userId: session.user.id,
          channel: NotificationChannel.PUSH,
          subject: "Commercial SLA breach scan complete",
          body: `Detected ${result.breaches.length} breach(es).${issuesCreated > 0 ? ` Created ${issuesCreated} issue ticket(s).` : ""}`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    return NextResponse.json({
      ...result,
      issuesCreated,
    });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "SLA run failed." }, { status });
  }
}

