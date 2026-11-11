import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deleteCase, getCaseById } from "@/lib/cases/service";
import { applyCaseUpdate } from "@/lib/cases/apply-update";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { CASE_STATUSES } from "@/lib/cases/status";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(6000).optional().nullable(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(CASE_STATUSES).optional(),
  statusChangeNote: z.string().trim().max(4000).optional(),
  assignedToUserId: z.string().trim().optional().nullable(),
  clientVisible: z.boolean().optional(),
  clientCanReply: z.boolean().optional(),
  resolutionNote: z.string().trim().max(4000).optional().nullable(),
  caseType: z.string().trim().optional(),
  // Linking after the fact. The columns always existed; nothing could set
  // them once the case was created, so a case raised over the phone stayed
  // detached from the job it was about. Empty string unlinks.
  jobId: z.string().trim().optional().nullable(),
  propertyId: z.string().trim().optional().nullable(),
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
    const { statusChangeNote, ...patch } = body;
    // The rules (required status note, status comment, notification) live in
    // applyCaseUpdate so the bulk endpoint applies exactly the same ones.
    const result = await applyCaseUpdate({
      caseId: params.id,
      patch,
      statusChangeNote,
      actor: { id: session.user.id, name: session.user.name, email: session.user.email },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const updated = result.case;
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
    await verifySensitiveAction(session.user.id, body?.security, "cases.delete");
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
