import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DOCUMENT_TYPES, previewDocument, sendDocument, type DocumentType } from "@/lib/notifications/documents";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  docType: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  mode: z.enum(["preview", "send"]),
});

/** POST — preview or re-send a document to the client. Always preview-first in the UI. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());
    const docType = body.docType as DocumentType;
    if (!DOCUMENT_TYPES[docType]) {
      return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
    }

    const client = await db.client.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

    if (body.mode === "preview") {
      const preview = await previewDocument(params.id, docType, body.targetId);
      return NextResponse.json(preview);
    }

    const result = await sendDocument(params.id, docType, body.targetId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Could not send the document." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, recipients: result.recipients });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
