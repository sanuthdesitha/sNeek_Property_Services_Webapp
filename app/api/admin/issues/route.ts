import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { listCaseAssignees, listCases } from "@/lib/cases/service";

const querySchema = z.object({
  status: z.string().optional(),
  scope: z.enum(["all", "lost-found", "damage", "sla", "other"]).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "ALL"]).optional(),
  assigneeUserId: z.string().trim().optional(),
  q: z.string().trim().optional(),
  overdueOnly: z.enum(["true", "false"]).optional(),
});

const scopeToCaseType: Record<string, string | null> = {
  all: null,
  "lost-found": "LOST_FOUND",
  damage: "DAMAGE",
  sla: "SLA",
  other: "OTHER",
};

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

    const [rows, assignees] = await Promise.all([
      listCases({
        status: parsed.status && parsed.status !== "ALL" ? parsed.status : null,
        caseType: scopeToCaseType[parsed.scope ?? "all"],
        assigneeUserId: parsed.assigneeUserId ?? null,
        q: parsed.q ?? null,
      }),
      listCaseAssignees(),
    ]);

    let items = rows
      .filter((item) => (parsed.severity && parsed.severity !== "ALL" ? item.severity === parsed.severity : true))
      .map((item) => {
        const dueAt = item.dueAt ? new Date(item.dueAt) : null;
        const overdue = Boolean(
          dueAt &&
            !Number.isNaN(dueAt.getTime()) &&
            item.status !== "RESOLVED" &&
            dueAt.getTime() < Date.now()
        );
        const ageHours = Math.max(
          0,
          Math.round((Date.now() - new Date(item.createdAt).getTime()) / 3600000)
        );
        return {
          ...item,
          descriptionText: item.description,
          summary: item.description,
          updates: item.comments.map((comment: any) => ({
            atLabel: new Date(comment.createdAt).toLocaleString("en-AU"),
            actorLabel: comment.author?.name || comment.author?.email || "User",
            note: `${comment.isInternal ? "[Internal] " : ""}${comment.body}`,
          })),
          evidenceKeys: item.attachments.map((attachment: any) => attachment.s3Key),
          meta: {
            assigneeUserId: item.assignedTo?.id ?? null,
            dueAt: item.dueAt,
            tags: item.tags,
          },
          overdue,
          ageHours,
        };
      });

    if (parsed.overdueOnly === "true") {
      items = items.filter((item) => item.overdue);
    }

    items.sort((left, right) => {
      if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

    return NextResponse.json({
      items,
      assignees,
      summary: {
        total: items.length,
        openCount: items.filter((item) => item.status !== "RESOLVED").length,
        overdueCount: items.filter((item) => item.overdue).length,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load cases." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
