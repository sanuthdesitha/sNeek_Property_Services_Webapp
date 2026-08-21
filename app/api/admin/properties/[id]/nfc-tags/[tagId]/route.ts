import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Rename, retire or remove one tag.
 *
 * RETIRE (`isActive: false`) is the option to reach for, and the one the UI
 * offers first. A tag that has fallen off a wall, or gone through a washing
 * machine in someone's pocket, should stop working — but its scan history is
 * how you find out where it went, and deleting the row throws that away.
 *
 * DELETE stays available for a tag registered by mistake. The scan events
 * survive it: `NfcScanEvent.tagId` is ON DELETE SET NULL and each event keeps
 * its own copy of the token, so the record of what was presented outlives the
 * tag it was presented against.
 */

const updateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});

async function loadTag(propertyId: string, tagId: string) {
  const tag = await db.propertyNfcTag.findUnique({
    where: { id: tagId },
    select: { id: true, propertyId: true },
  });
  // Scoped to the property in the URL, not just to the id. Without this an
  // admin could edit any tag in the business through any property's endpoint.
  if (!tag || tag.propertyId !== propertyId) return null;
  return tag;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; tagId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateSchema.parse(await req.json().catch(() => ({})));

    const existing = await loadTag(params.id, params.tagId);
    if (!existing) return NextResponse.json({ error: "Tag not found." }, { status: 404 });

    const tag = await db.propertyNfcTag.update({
      where: { id: params.tagId },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      select: {
        id: true,
        label: true,
        tagUid: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ tag });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not update the tag." }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; tagId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const existing = await loadTag(params.id, params.tagId);
    if (!existing) return NextResponse.json({ error: "Tag not found." }, { status: 404 });

    await db.propertyNfcTag.delete({ where: { id: params.tagId } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not remove the tag." }, { status });
  }
}
