import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
import { ActionReceiptError, CLEANER_ACTIONS, recoverCleanerAction } from "@/lib/cleaner/action-receipt";
const schema = z.object({ requestId: z.string().uuid(), action: z.enum(CLEANER_ACTIONS), input: z.record(z.unknown()) }).strict();
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    if (request.headers.get("X-Cleaner-Draft-Identity") !== cleanerDraftIdentity(session, params.id)) {
      return NextResponse.json({ error: "Account context changed. Reload this job." }, { status: 409 });
    }
    const body = schema.parse(await request.json());
    const result = await recoverCleanerAction({ session, jobId: params.id, action: body.action, requestId: body.requestId, body: body.input, draftIdentity: request.headers.get("X-Cleaner-Draft-Identity") });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    const status = error instanceof ActionReceiptError ? error.status : error instanceof z.ZodError ? 400 : error.message === "UNAUTHORIZED" ? 401 : error.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: error.message ?? "Action recovery could not be confirmed." }, { status });
  }
}
