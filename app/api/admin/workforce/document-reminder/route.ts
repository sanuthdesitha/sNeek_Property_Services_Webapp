import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { previewDocumentReminder } from "@/lib/workforce/document-reminder";
import { optionsForPerson } from "@/lib/workforce/document-request-options";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * GET ?documentId= — what Command's "Send reminder" will send and to whom
 * (the person, which contacts exist, the request title and wording) and
 * whether a reminder for this document was already sent today, plus the
 * transport options and the office user's saved choice (as Accounts "Request
 * document" shows them). Read-only;
 * the send is POST /api/admin/workforce { action: "REQUEST_DOCUMENT", documentId }.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const documentId = req.nextUrl.searchParams.get("documentId")?.trim() ?? "";
    if (!documentId || documentId.length > 200) return NextResponse.json({ error: "documentId is required." }, { status: 400, headers });
    const preview = await previewDocumentReminder(documentId);
    if (!preview) return NextResponse.json({ error: "Document not found." }, { status: 404, headers });
    const options = await optionsForPerson(preview.person, { id: session.user.id, impersonating: Boolean(session.impersonation) });
    return NextResponse.json({ ...preview, options }, { headers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not prepare the reminder.";
    return NextResponse.json({ error: message }, { status: getApiErrorStatus(err), headers });
  }
}
