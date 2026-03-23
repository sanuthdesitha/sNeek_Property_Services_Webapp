import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deleteCase, getCaseById, updateCase } from "@/lib/cases/service";
import { notifyCaseUpdated } from "@/lib/cases/notifications";
import { verifySensitiveAction } from "@/lib/security/admin-verification";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(6000).optional().nullable(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
  assignedToUserId: z.string().trim().optional().nullable(),
  clientVisible: z.boolean().optional(),
  clientCanReply: z.boolean().optional(),
  resolutionNote: z.string().trim().max(4000).optional().nullable(),
  caseType: z.string().trim().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const row = await getCaseById(params.id);
    if (!row) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load case." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const updated = await updateCase(params.id, body);
    if (!updated) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    await notifyCaseUpdated({
      caseItem: updated,
      actorLabel: session.user.name || session.user.email || "Admin",
      updateNote: body.status
        ? `Status updated to ${body.status.replace(/_/g, " ")}`
        : "Case details updated",
      notifyClient: body.clientVisible === true || updated.clientVisible === true,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not update case." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, body?.security);
    const ok = await deleteCase(params.id);
    if (!ok) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELETE_CASE",
        entity: "IssueTicket",
        entityId: params.id,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not delete case." },
      {
        status:
          err.message === "UNAUTHORIZED"
            ? 401
            : err.message === "FORBIDDEN"
              ? 403
              : err.message === "INVALID_SECURITY_VERIFICATION" || err.message === "PIN_OR_PASSWORD_REQUIRED"
                ? 423
                : 400,
      }
    );
  }
}
