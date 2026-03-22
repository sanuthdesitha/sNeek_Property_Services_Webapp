import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { addCaseAttachment, getCaseById } from "@/lib/cases/service";
import { notifyCaseUpdated } from "@/lib/cases/notifications";

const schema = z.object({
  s3Key: z.string().trim().min(1),
  url: z.string().trim().optional().nullable(),
  mimeType: z.string().trim().optional().nullable(),
  label: z.string().trim().optional().nullable(),
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
    const updated = await addCaseAttachment({
      caseId: params.id,
      uploadedByUserId: session.user.id,
      s3Key: body.s3Key,
      url: body.url,
      mimeType: body.mimeType,
      label: body.label,
    });
    if (updated) {
      await notifyCaseUpdated({
        caseItem: updated,
        actorLabel: session.user.name || session.user.email || "Admin",
        updateNote: "Evidence attached to the case",
      });
    }
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not add attachment." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
