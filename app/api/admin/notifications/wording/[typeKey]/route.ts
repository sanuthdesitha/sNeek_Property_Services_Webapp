import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireWordingEditor } from "@/lib/notifications/wording/permission";
import { saveWording } from "@/lib/notifications/wording/store";
import { typeWordingResponse, WORDING_HEADERS, wordingErrorResponse } from "@/lib/notifications/wording/route-support";

type Params = { params: { typeKey: string } };

/** GET: the editor view of one type (parts, live wording, versions, permissions). */
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const view = await typeWordingResponse(session, decodeURIComponent(params.typeKey));
    if (!view) return NextResponse.json({ error: "Unknown notification type." }, { status: 404, headers: WORDING_HEADERS });
    return NextResponse.json(view, { headers: WORDING_HEADERS });
  } catch (error) {
    return wordingErrorResponse(error, "Could not load this notification's wording.");
  }
}

const fieldsSchema = z.object({ title: z.string().max(2000).optional(), subject: z.string().max(2000).optional(), body: z.string().max(20000).optional() }).strict();

const saveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EDIT"), partId: z.string().min(1).max(60), transport: z.enum(["INBOX", "PUSH", "EMAIL", "SMS"]), fields: fieldsSchema, expectedHash: z.string().min(1).max(80), change: z.string().max(200).optional() }).strict(),
  z.object({ kind: z.literal("RESTORE"), partId: z.string().min(1).max(60), transport: z.enum(["INBOX", "PUSH", "EMAIL", "SMS"]), restoreVersion: z.number().int().min(1), expectedHash: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("RESET"), partId: z.string().min(1).max(60), transport: z.enum(["INBOX", "PUSH", "EMAIL", "SMS"]), expectedHash: z.string().min(1).max(80) }).strict(),
]);

/**
 * PUT: save a new version (edit, restore or reset to default). ADMIN, or an
 * operations manager with the notifications pack at Manage; never while
 * impersonating. Invalid wording 400, stale write 409. Audited.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actorRole = await requireWordingEditor(session);
    const body = saveSchema.parse(await request.json());
    const typeKey = decodeURIComponent(params.typeKey);
    const saved = await saveWording({
      typeKey,
      partId: body.partId,
      transport: body.transport,
      kind: body.kind,
      fields: body.kind === "EDIT" ? body.fields : undefined,
      restoreVersion: body.kind === "RESTORE" ? body.restoreVersion : undefined,
      expectedHash: body.expectedHash,
      change: body.kind === "EDIT" ? body.change : body.kind === "RESTORE" ? `Restored v${body.restoreVersion}` : "Reset to default",
      actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? null, role: actorRole },
    });
    const view = await typeWordingResponse(session, typeKey);
    return NextResponse.json({ saved, view }, { headers: WORDING_HEADERS });
  } catch (error) {
    return wordingErrorResponse(error, "The wording could not be saved. Your draft is kept.");
  }
}
