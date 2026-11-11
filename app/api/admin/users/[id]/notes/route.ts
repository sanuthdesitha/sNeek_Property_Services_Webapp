import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const notesSchema = z.object({
  notes: z.string().trim().max(8000).nullable().optional(),
});

/**
 * Update the office's private note on an account (User.adminNotes). Used by
 * the Accounts hub. The request and response keep the `notes` key.
 *
 * This is not User.notes: that is the person's own "notes to admin", which
 * they can read and edit on their profile. The two shared one column until
 * 2026-11, so the office's note was visible to the person it was about.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = notesSchema.parse(await req.json());

    const existing = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, adminNotes: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const nextNotes = body.notes?.trim() || null;
    const updated = await db.user.update({
      where: { id: params.id },
      data: { adminNotes: nextNotes },
      select: { id: true, adminNotes: true },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "UPDATE_USER_NOTES",
        entity: "User",
        entityId: params.id,
        before: { adminNotes: existing.adminNotes } as any,
        after: { adminNotes: nextNotes } as any,
      },
    });

    return NextResponse.json({ id: updated.id, notes: updated.adminNotes });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not save notes." }, { status });
  }
}
