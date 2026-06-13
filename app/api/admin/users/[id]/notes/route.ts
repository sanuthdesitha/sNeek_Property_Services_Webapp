import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const notesSchema = z.object({
  notes: z.string().trim().max(8000).nullable().optional(),
});

/**
 * Update the admin-facing notes on a staff account (User.notes — existing
 * field, no schema change). Used by the Accounts hub staff summary page.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = notesSchema.parse(await req.json());

    const existing = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, notes: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const nextNotes = body.notes?.trim() || null;
    const updated = await db.user.update({
      where: { id: params.id },
      data: { notes: nextNotes },
      select: { id: true, notes: true },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "UPDATE_USER_NOTES",
        entity: "User",
        entityId: params.id,
        before: { notes: existing.notes } as any,
        after: { notes: nextNotes } as any,
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not save notes." }, { status });
  }
}
