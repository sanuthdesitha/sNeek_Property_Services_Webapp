import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { composeCaseDescription, getIssueCaseType, parseCaseDescription } from "@/lib/issues/case-utils";

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  resolutionNote: z.string().trim().optional(),
  assigneeUserId: z.string().trim().nullable().optional(),
  dueAt: z.string().trim().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateSchema.parse(await req.json());

    const existing = await db.issueTicket.findUnique({
      where: { id: params.id },
      select: { id: true, description: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }

    const parsed = parseCaseDescription(existing.description);
    let plainText = parsed.text ?? "";

    let assigneeUserId =
      body.assigneeUserId !== undefined
        ? body.assigneeUserId?.trim() || null
        : parsed.metadata.assigneeUserId ?? null;

    if (assigneeUserId) {
      const assignee = await db.user.findFirst({
        where: {
          id: assigneeUserId,
          role: { in: [Role.ADMIN, Role.OPS_MANAGER] },
          isActive: true,
        },
        select: { id: true },
      });
      if (!assignee) {
        return NextResponse.json({ error: "Invalid assignee user." }, { status: 400 });
      }
      assigneeUserId = assignee.id;
    }

    const dueAtRaw =
      body.dueAt !== undefined ? body.dueAt?.trim() || null : parsed.metadata.dueAt ?? null;
    let dueAt: string | null = null;
    if (dueAtRaw) {
      const dueDate = new Date(dueAtRaw);
      if (Number.isNaN(dueDate.getTime())) {
        return NextResponse.json({ error: "Invalid due date." }, { status: 400 });
      }
      dueAt = dueDate.toISOString();
    }

    const tags =
      body.tags !== undefined
        ? body.tags
            .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
            .filter(Boolean)
            .slice(0, 20)
        : parsed.metadata.tags ?? [];

    if (body.resolutionNote) {
      const stamp = new Date().toLocaleString("en-AU");
      plainText = `${plainText}\n\n[${stamp}] Resolution note by ${session.user.name ?? session.user.email}:\n${body.resolutionNote}`;
    }
    const description = composeCaseDescription({
      text: plainText,
      metadata: {
        assigneeUserId,
        dueAt,
        tags,
      },
    });

    const updated = await db.issueTicket.update({
      where: { id: params.id },
      data: {
        status: body.status,
        severity: body.severity,
        description,
      },
      include: {
        job: {
          select: {
            id: true,
            property: { select: { name: true, suburb: true } },
          },
        },
      },
    });

    const parsedUpdated = parseCaseDescription(updated.description);
    const resolvedDueAt = parsedUpdated.metadata.dueAt ? new Date(parsedUpdated.metadata.dueAt) : null;
    const dueAtIso = resolvedDueAt && !Number.isNaN(resolvedDueAt.getTime()) ? resolvedDueAt.toISOString() : null;
    const response = {
      ...updated,
      caseType: getIssueCaseType(updated.title),
      descriptionText: parsedUpdated.text,
      summary: parsedUpdated.summary,
      updates: parsedUpdated.updates,
      evidenceKeys: parsedUpdated.evidenceKeys,
      meta: {
        assigneeUserId: parsedUpdated.metadata.assigneeUserId ?? null,
        dueAt: dueAtIso,
        tags: parsedUpdated.metadata.tags ?? [],
      },
      overdue: Boolean(dueAtIso && updated.status !== "RESOLVED" && new Date(dueAtIso).getTime() < Date.now()),
    };

    return NextResponse.json(response);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
