import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { designAccess } from "@/lib/email-design/permission";
import { discardDesignDraft, EmailDesignError, resetDesignToStandard, restoreDesignVersion, saveDesignDraft } from "@/lib/email-design/store";
import { DESIGN_HEADERS, designError, designView } from "@/lib/email-design/view";

/**
 * GET: one email's stored versions, draft, live look and Company details.
 * PUT: change the DRAFT only (save, restore a version as the draft, reset to
 * standard as the draft, discard). Nothing here reaches anyone: publishing is
 * its own route (ADMIN, own PIN). Allowed for administrators and operations
 * managers with the communications pack at Manage; never while impersonating.
 * Stale writes (another tab or person) answer 409 and keep the editor's draft.
 */
const bodySchema = z.object({
  action: z.enum(["DRAFT", "RESTORE", "RESET", "DISCARD"]),
  expectedRevision: z.number().int().min(0),
  doc: z.unknown().optional(),
  version: z.number().int().min(1).optional(),
  idempotencyKey: z.string().min(8).max(100).optional().nullable(),
});

export async function GET(_request: Request, { params }: { params: { key: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await designView(session, params.key), { headers: DESIGN_HEADERS });
  } catch (error) {
    return designError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { key: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const access = await designAccess(session);
    if (!access.canDraft || !access.actorRole) throw new EmailDesignError(403, access.draftReason ?? "You cannot change email designs.");
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new EmailDesignError(400, "Invalid request. Nothing was saved.");
    const body = parsed.data;
    const actor = { id: session.user.id, name: session.user.name ?? null, role: access.actorRole };
    const change = { key: params.key, expectedRevision: body.expectedRevision, actor };
    const row =
      body.action === "DRAFT" ? await saveDesignDraft({ ...change, doc: body.doc, idempotencyKey: body.idempotencyKey ?? null })
      : body.action === "RESTORE" ? await restoreDesignVersion({ ...change, version: body.version ?? 0 })
      : body.action === "RESET" ? await resetDesignToStandard(change)
      : await discardDesignDraft(change);
    return NextResponse.json(await designView(session, params.key, row), { headers: DESIGN_HEADERS });
  } catch (error) {
    return designError(error);
  }
}
