import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getIssueCaseType, parseCaseDescription } from "@/lib/issues/case-utils";

const querySchema = z.object({
  status: z.string().optional(),
  scope: z.enum(["all", "lost-found", "damage", "sla", "other"]).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "ALL"]).optional(),
  assigneeUserId: z.string().trim().optional(),
  q: z.string().trim().optional(),
  overdueOnly: z.enum(["true", "false"]).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.parse({
      status: searchParams.get("status") ?? undefined,
      scope: searchParams.get("scope") ?? undefined,
      severity: searchParams.get("severity") ?? undefined,
      assigneeUserId: searchParams.get("assigneeUserId") ?? undefined,
      q: searchParams.get("q") ?? undefined,
      overdueOnly: searchParams.get("overdueOnly") ?? undefined,
    });

    const where: any = {};
    if (parsed.status && parsed.status !== "ALL") where.status = parsed.status;
    if (parsed.severity && parsed.severity !== "ALL") where.severity = parsed.severity;
    if (parsed.scope === "lost-found") where.title = { startsWith: "Lost & Found:" };
    if (parsed.scope === "damage") where.title = { startsWith: "Damage:" };
    if (parsed.scope === "sla") where.title = { startsWith: "SLA breach" };
    if (parsed.q) {
      where.OR = [
        { title: { contains: parsed.q, mode: "insensitive" } },
        { description: { contains: parsed.q, mode: "insensitive" } },
      ];
    }

    const rawItems = await db.issueTicket.findMany({
      where,
      include: {
        job: {
          select: {
            id: true,
            status: true,
            scheduledDate: true,
            property: {
              select: { id: true, name: true, suburb: true },
            },
          },
        },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 500,
    });

    const now = Date.now();
    const parsedItems = rawItems.map((item) => {
      const parsedDescription = parseCaseDescription(item.description);
      const dueAt = parsedDescription.metadata.dueAt ? new Date(parsedDescription.metadata.dueAt) : null;
      const dueAtValid = dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt.toISOString() : null;
      const overdue = Boolean(
        dueAtValid &&
          item.status !== "RESOLVED" &&
          new Date(dueAtValid).getTime() < now
      );
      const ageHours = Math.max(0, Math.round((now - item.createdAt.getTime()) / 3600000));
      return {
        ...item,
        caseType: getIssueCaseType(item.title),
        descriptionText: parsedDescription.text,
        summary: parsedDescription.summary,
        updates: parsedDescription.updates,
        evidenceKeys: parsedDescription.evidenceKeys,
        meta: {
          assigneeUserId: parsedDescription.metadata.assigneeUserId ?? null,
          dueAt: dueAtValid,
          tags: parsedDescription.metadata.tags ?? [],
        },
        ageHours,
        overdue,
      };
    });

    const assigneeIds = Array.from(
      new Set(
        parsedItems
          .map((item) => item.meta.assigneeUserId)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );

    const assigneeUsers = await db.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.OPS_MANAGER] },
        isActive: true,
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      take: 200,
    });

    const assigneeMap = new Map(assigneeUsers.map((user) => [user.id, user]));
    const allAssigneeIds = Array.from(new Set([...assigneeIds, ...assigneeUsers.map((user) => user.id)]));

    let items = parsedItems.map((item) => ({
      ...item,
      assignee: item.meta.assigneeUserId ? assigneeMap.get(item.meta.assigneeUserId) ?? null : null,
    }));

    if (parsed.scope === "other") {
      items = items.filter((item) => item.caseType === "OTHER");
    }
    if (parsed.assigneeUserId) {
      if (parsed.assigneeUserId === "__unassigned") {
        items = items.filter((item) => !item.meta.assigneeUserId);
      } else {
        items = items.filter((item) => item.meta.assigneeUserId === parsed.assigneeUserId);
      }
    }
    if (parsed.overdueOnly === "true") {
      items = items.filter((item) => item.overdue);
    }

    const statusRank: Record<string, number> = {
      OPEN: 1,
      IN_PROGRESS: 2,
      RESOLVED: 3,
    };
    items.sort((left, right) => {
      if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
      const statusDiff = (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9);
      if (statusDiff !== 0) return statusDiff;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });

    const response = {
      items,
      assignees: allAssigneeIds
        .map((id) => assigneeMap.get(id))
        .filter((user): user is NonNullable<typeof user> => Boolean(user)),
      summary: {
        total: items.length,
        openCount: items.filter((item) => item.status !== "RESOLVED").length,
        overdueCount: items.filter((item) => item.overdue).length,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
