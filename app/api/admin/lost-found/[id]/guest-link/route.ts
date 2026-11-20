import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { activeGuestLink, ensureGuestLink, GuestLinkError, revokeGuestLink } from "@/lib/lost-found/guest-link";

/**
 * The guest's link for one item (2026-11-20). ADMIN and OPS_MANAGER; the live
 * session guard applies the Lost & found pack (read for GET, manage for POST).
 *
 * GET  → { link } (the open link, or null).
 * POST { mode: "ensure" } → the open link, created when none is open;
 *      { mode: "renew" }  → a fresh link (the previous one stops working);
 *      { mode: "revoke" } → switches the link off.
 */
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const bodySchema = z.object({ mode: z.enum(["ensure", "renew", "revoke"]) }).strict();

function failure(error: unknown) {
  if (error instanceof GuestLinkError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Choose ensure, renew or revoke." }, { status: 400, headers });
  const message = error instanceof Error ? error.message : "";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: status === 500 ? "The guest link could not be changed." : message }, { status, headers });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const item = await db.lostFoundItem.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404, headers });
    return NextResponse.json({ link: await activeGuestLink(item.id) }, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { mode } = bodySchema.parse(await req.json());
    if (mode === "revoke") {
      await revokeGuestLink(params.id, session.user.id);
      return NextResponse.json({ link: null }, { headers });
    }
    return NextResponse.json({ link: await ensureGuestLink(params.id, session.user.id, mode) }, { headers });
  } catch (error) {
    return failure(error);
  }
}
