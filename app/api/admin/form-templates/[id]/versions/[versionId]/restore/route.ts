import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { restoreTemplateVersion } from "@/lib/forms/template-drafts";
import { templateErrorResponse } from "@/lib/forms/template-errors";

const restoreSchema = z.object({ replaceDraft: z.boolean().optional() });

/**
 * Restore an earlier published version as the form's DRAFT. Nothing reaches
 * cleaners until the draft is published, and the old version row is kept.
 * An existing draft is replaced only with `replaceDraft: true` (else 409).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = restoreSchema.parse(await req.json().catch(() => ({})));
    const restored = await restoreTemplateVersion({
      templateId: params.id,
      versionId: params.versionId,
      actorId: session.user.id,
      replaceDraft: body.replaceDraft === true,
    });
    return NextResponse.json({ draft: { id: restored.draft.id, note: restored.draft.note }, editToken: restored.token });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
