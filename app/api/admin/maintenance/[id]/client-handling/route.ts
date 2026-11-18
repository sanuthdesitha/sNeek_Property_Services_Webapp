/**
 * Client-handled maintenance, the office side (2026-11-18).
 *
 *   GET  /api/admin/maintenance/:id/client-handling
 *        → { view, preview: { handover, reminder } }
 *   POST /api/admin/maintenance/:id/client-handling
 *        { action: "HAND_OVER", note?, transports, requestKey }
 *        { action: "REMIND", transports, requestKey }
 *        { action: "TAKE_BACK", reason }
 *
 * Guard: the live role guard (ADMIN, OPS_MANAGER). An operations manager is
 * held to their Maintenance pack by requireSession (read to GET, manage to
 * POST). ADMIN has full rights regardless of packs. Writes are refused while
 * viewing as someone else in read-only mode (middleware, and again here).
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { REASON_REQUIRED_MESSAGE, requiredReason } from "@/lib/confirmations/reasons";
import {
  ClientHandlingError,
  getAdminClientHandlingView,
  handOverToClient,
  remindClient,
  takeBackFromClient,
} from "@/lib/maintenance/client-handling";
import { previewClientMessage } from "@/lib/maintenance/client-handling-notices";

export const dynamic = "force-dynamic";

const transportsSchema = z.array(z.enum(["INBOX", "EMAIL"])).max(2);
const requestKeySchema = z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("HAND_OVER"), note: z.string().max(1000).optional().nullable(), transports: transportsSchema, requestKey: requestKeySchema }).strict(),
  z.object({ action: z.literal("REMIND"), transports: transportsSchema, requestKey: requestKeySchema }).strict(),
  z.object({ action: z.literal("TAKE_BACK"), reason: z.string().max(2000) }).strict(),
]);

function failure(err: unknown, fallback: string) {
  if (err instanceof ClientHandlingError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof z.ZodError) return NextResponse.json({ error: "That request was not understood. Reload the page and try again." }, { status: 400 });
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "You do not have access to this." }, { status: 403 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const view = await getAdminClientHandlingView(params.id);
    if (!view) return NextResponse.json({ error: "This item no longer exists." }, { status: 404 });
    const [handover, reminder] = await Promise.all([
      previewClientMessage("handover", params.id, null).catch(() => null),
      previewClientMessage("reminder", params.id, null).catch(() => null),
    ]);
    return NextResponse.json({ view, preview: { handover, reminder } });
  } catch (err) {
    return failure(err, "The client handling could not be loaded.");
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation?.mode === "READ_ONLY") {
      return NextResponse.json({ error: "Not available while viewing as someone else in read-only mode." }, { status: 403 });
    }
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const actor = { userId: session.user.id, impersonatedBy: session.impersonation?.actorId ?? null };
    if (body.action === "HAND_OVER") {
      const result = await handOverToClient({ itemId: params.id, actor, note: body.note ?? null, transports: body.transports, requestKey: body.requestKey });
      return NextResponse.json(result);
    }
    if (body.action === "REMIND") {
      const result = await remindClient({ itemId: params.id, actor, transports: body.transports, requestKey: body.requestKey });
      return NextResponse.json(result);
    }
    const reason = requiredReason(body.reason);
    if (!reason) return NextResponse.json({ error: REASON_REQUIRED_MESSAGE }, { status: 400 });
    const view = await takeBackFromClient({ itemId: params.id, actor, reason });
    return NextResponse.json({ outcome: "done", view });
  } catch (err) {
    return failure(err, "That could not be saved. Nothing was changed.");
  }
}
