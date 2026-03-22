import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  addCaseAttachment,
  addCaseComment,
  getCaseById,
  toClientCaseView,
  updateCase,
} from "@/lib/cases/service";
import { notifyCaseUpdated } from "@/lib/cases/notifications";

const patchSchema = z.object({
  comment: z.string().trim().max(4000).optional(),
  s3Key: z.string().trim().optional(),
  url: z.string().trim().optional().nullable(),
  mimeType: z.string().trim().optional().nullable(),
  label: z.string().trim().optional().nullable(),
  status: z.enum(["OPEN"]).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    const row = await getCaseById(params.id);
    if (!row || row.client?.id !== user.clientId || row.clientVisible !== true) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    return NextResponse.json(toClientCaseView(row));
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
    const session = await requireRole([Role.CLIENT]);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    const current = await getCaseById(params.id);
    if (!current || current.client?.id !== user.clientId || current.clientVisible !== true) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    if (current.clientCanReply === false) {
      return NextResponse.json({ error: "Replies are disabled for this case." }, { status: 403 });
    }
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    let updated = current!;
    if (body.comment?.trim()) {
      const commentResult = await addCaseComment({
        caseId: params.id,
        authorUserId: session.user.id,
        body: body.comment,
        isInternal: false,
      });
      if (commentResult) updated = commentResult;
    }
    if (body.s3Key?.trim()) {
      const attachmentResult = await addCaseAttachment({
        caseId: params.id,
        uploadedByUserId: session.user.id,
        s3Key: body.s3Key,
        url: body.url,
        mimeType: body.mimeType,
        label: body.label,
      });
      if (attachmentResult) updated = attachmentResult;
    }
    if (body.status) {
      const statusResult = await updateCase(params.id, { status: body.status });
      if (statusResult) updated = statusResult;
    }

    await notifyCaseUpdated({
      caseItem: updated,
      actorLabel: session.user.name || session.user.email || "Client",
      updateNote: body.comment?.trim()
        ? "Client added a reply"
        : body.s3Key?.trim()
          ? "Client attached evidence"
          : body.status
            ? `Client reopened the case`
            : "Client updated the case",
      notifyClient: false,
    });

    return NextResponse.json(toClientCaseView(updated));
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not update case." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
