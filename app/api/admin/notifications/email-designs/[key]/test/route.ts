import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { parseDocument } from "@/lib/email-design/checks";
import { designAccess } from "@/lib/email-design/permission";
import { EmailDesignError } from "@/lib/email-design/store";
import { sendEmailDesignTest } from "@/lib/email-design/test-send";
import { DESIGN_HEADERS, designError } from "@/lib/email-design/view";

/**
 * POST { doc?, sampleId? }: send this email (the draft when given, otherwise
 * the live version) to the signed-in person's OWN account address, marked
 * [Test], with invented sample values, through the real send path and the
 * sending safeguards. Administrators and operations managers who may draft;
 * never while impersonating. No address is accepted from the request.
 */
const bodySchema = z.object({ doc: z.unknown().optional().nullable(), sampleId: z.string().max(40).optional().nullable() });

export async function POST(request: Request, { params }: { params: { key: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) throw new EmailDesignError(403, "Test sends are not available while testing as someone else.");
    const access = await designAccess(session);
    if (!access.canDraft || !access.actorRole) throw new EmailDesignError(403, access.draftReason ?? "You cannot send email tests.");
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new EmailDesignError(400, "Invalid request. Nothing was sent.");
    const doc = parsed.data.doc ? parseDocument(parsed.data.doc) : null;
    if (parsed.data.doc && !doc) throw new EmailDesignError(400, "The draft could not be read. Nothing was sent.");
    const outcome = await sendEmailDesignTest({ actorId: session.user.id, actorRole: access.actorRole, key: params.key, doc, theme: null, sampleId: parsed.data.sampleId ?? null });
    return NextResponse.json(outcome, { headers: DESIGN_HEADERS });
  } catch (error) {
    return designError(error);
  }
}
