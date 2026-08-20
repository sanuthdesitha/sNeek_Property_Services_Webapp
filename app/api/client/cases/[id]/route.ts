import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireClientPortal } from "@/lib/auth/client-portal";
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
    // A VA raising a case could not then open it: requireRole([Role.CLIENT])
    // threw FORBIDDEN for them, and User.clientId is null for a VA anyway, so
    // even past the role check this answered "Client profile missing". The
    // LIST route beside this one was migrated in B16b; this one was missed.
    const portal = await requireClientPortal({ permission: "maintenance" });
    const row = await getCaseById(params.id);
    if (!row || row.client?.id !== portal.clientId || row.clientVisible !== true) {
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
    // A VA raising a case could not then open it: requireRole([Role.CLIENT])
    // threw FORBIDDEN for them, and User.clientId is null for a VA anyway, so
    // even past the role check this answered "Client profile missing". The
    // LIST route beside this one was migrated in B16b; this one was missed.
    const portal = await requireClientPortal({ permission: "maintenance" });
    const current = await getCaseById(params.id);
    if (!current || current.client?.id !== portal.clientId || current.clientVisible !== true) {
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
        authorUserId: portal.userId,
        body: body.comment,
        isInternal: false,
      });
      if (commentResult) updated = commentResult;
    }
    if (body.s3Key?.trim()) {
      const attachmentResult = await addCaseAttachment({
        caseId: params.id,
        uploadedByUserId: portal.userId,
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
      // The ACTING person, not the account they act for — an assistant’s reply
      // must not read as though the client wrote it.
      actorLabel:
        portal.userName || (portal.actor === "VA" ? "Assistant" : "Client"),
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
