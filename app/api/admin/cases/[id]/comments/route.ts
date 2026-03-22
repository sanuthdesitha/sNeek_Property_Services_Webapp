import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { addCaseComment, getCaseById } from "@/lib/cases/service";
import { notifyCaseUpdated } from "@/lib/cases/notifications";

const schema = z.object({
  body: z.string().trim().min(1).max(4000),
  isInternal: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const current = await getCaseById(params.id);
    if (!current) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    const body = schema.parse(await req.json().catch(() => ({})));
    const updated = await addCaseComment({
      caseId: params.id,
      authorUserId: session.user.id,
      body: body.body,
      isInternal: body.isInternal,
    });
    if (updated) {
      await notifyCaseUpdated({
        caseItem: updated,
        actorLabel: session.user.name || session.user.email || "Admin",
        updateNote: body.isInternal ? "Internal note added" : "New case update posted",
        notifyClient: body.isInternal !== true,
      });
    }
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not add comment." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
