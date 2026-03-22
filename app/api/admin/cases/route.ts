import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createCase, listCaseAssignees, listCases } from "@/lib/cases/service";
import { notifyCaseCreated } from "@/lib/cases/notifications";

const querySchema = z.object({
  status: z.string().trim().optional(),
  caseType: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  propertyId: z.string().trim().optional(),
  assigneeUserId: z.string().trim().optional(),
  q: z.string().trim().optional(),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(6000).optional().nullable(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
  caseType: z.string().trim().optional(),
  source: z.string().trim().optional().nullable(),
  jobId: z.string().trim().optional().nullable(),
  clientId: z.string().trim().optional().nullable(),
  propertyId: z.string().trim().optional().nullable(),
  reportId: z.string().trim().optional().nullable(),
  assignedToUserId: z.string().trim().optional().nullable(),
  clientVisible: z.boolean().optional(),
  clientCanReply: z.boolean().optional(),
  resolutionNote: z.string().trim().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const query = querySchema.parse({
      status: searchParams.get("status") ?? undefined,
      caseType: searchParams.get("caseType") ?? undefined,
      clientId: searchParams.get("clientId") ?? undefined,
      propertyId: searchParams.get("propertyId") ?? undefined,
      assigneeUserId: searchParams.get("assigneeUserId") ?? undefined,
      q: searchParams.get("q") ?? undefined,
    });

    const [items, assignees] = await Promise.all([
      listCases(query),
      listCaseAssignees(),
    ]);
    return NextResponse.json({ items, assignees });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load cases." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const created = await createCase({
      ...body,
      source: body.source ?? "ADMIN",
      comment: body.description?.trim()
        ? {
            authorUserId: session.user.id,
            body: body.description,
            isInternal: false,
          }
        : null,
    });
    if (created) {
      await notifyCaseCreated({
        caseItem: created,
        actorLabel: session.user.name || session.user.email || "Admin",
      });
    }
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not create case." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
