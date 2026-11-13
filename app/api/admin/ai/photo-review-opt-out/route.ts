import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { OptOutConflict, readPhotoReviewOptOut, savePhotoReviewOptOut } from "@/lib/ai/photo-review-opt-out";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const bodySchema = z.object({ expectedRevision: z.number().int().nonnegative(), propertyIds: z.array(z.string().min(1).max(200)).max(5000) }).strict();

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "Only administrators can change this." }, { status: 403, headers });
  return NextResponse.json({ error: "Opted-out properties could not be loaded or saved." }, { status: 500, headers });
}

async function state() {
  const optOut = await readPhotoReviewOptOut();
  const properties = await db.property.findMany({ where: { OR: [{ isActive: true }, { id: { in: optOut.propertyIds } }] }, select: { id: true, name: true, suburb: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 3000 });
  return { revision: optOut.revision, propertyIds: optOut.propertyIds, corrupt: optOut.corrupt, properties };
}

/** Properties opted out of AI photo review. Read: ADMIN and OPS_MANAGER; change: ADMIN as themselves. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await state(), { headers });
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) return NextResponse.json({ error: "This cannot be changed while testing as someone." }, { status: 403, headers });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose properties from the list." }, { status: 400, headers });
    try {
      await savePhotoReviewOptOut(parsed.data, session.user.id);
    } catch (error) {
      if (error instanceof OptOutConflict) return NextResponse.json({ error: error.message, current: error.current }, { status: 409, headers });
      if (error instanceof Error && error.message.startsWith("One or more properties")) return NextResponse.json({ error: error.message }, { status: 400, headers });
      throw error;
    }
    return NextResponse.json(await state(), { headers });
  } catch (error) { return failure(error); }
}
