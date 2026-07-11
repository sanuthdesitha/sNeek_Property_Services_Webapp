import { NextRequest, NextResponse } from "next/server";
import { Role, type LostFoundStatus } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { logger } from "@/lib/logger";
import { hydrateItemWithEvents } from "@/lib/lost-found/service";

const bodySchema = z.object({
  action: z.enum(["COMMENT", "OFFER_RETURN", "GUEST_CONTACTED"]),
  note: z.string().trim().max(4000).optional().nullable(),
  guestName: z.string().trim().max(180).optional().nullable(),
  guestContact: z.string().trim().max(500).optional().nullable(),
});

const ADMIN_ROLES = [Role.ADMIN, Role.OPS_MANAGER];

function errorStatus(err: any): number {
  if (err?.message === "UNAUTHORIZED") return 401;
  if (err?.message === "FORBIDDEN") return 403;
  return 400;
}

/**
 * POST — append a workflow event to an item's timeline.
 *  - COMMENT: anyone with access (admin/ops, or the cleaner who reported it).
 *  - OFFER_RETURN: admin/ops only → moves status to RETURN_OFFERED.
 *  - GUEST_CONTACTED: admin/ops only → moves status to GUEST_CONTACTED and can
 *    record the guest's name / contact on the item.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
    const body = bodySchema.parse(await req.json());

    const item = await db.lostFoundItem.findUnique({ where: { id: params.id } });
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });

    const isAdmin = ADMIN_ROLES.includes(session.user.role as any);

    if (!isAdmin) {
      // Cleaners can only COMMENT, and only on their own reports.
      if (body.action !== "COMMENT") throw new Error("FORBIDDEN");
      const settings = await getAppSettings();
      if (!isCleanerModuleEnabled(settings, "lostFound")) throw new Error("FORBIDDEN");
      if (item.reportedByUserId !== session.user.id) throw new Error("FORBIDDEN");
    }

    if (body.action === "COMMENT" && !body.note?.trim()) {
      return NextResponse.json({ error: "A comment note is required." }, { status: 400 });
    }

    // Status side-effects for workflow actions.
    const itemUpdate: Record<string, unknown> = {};
    if (body.action === "OFFER_RETURN") {
      itemUpdate.status = "RETURN_OFFERED" as LostFoundStatus;
    } else if (body.action === "GUEST_CONTACTED") {
      itemUpdate.status = "GUEST_CONTACTED" as LostFoundStatus;
      if (body.guestName !== undefined) itemUpdate.guestName = body.guestName?.trim() || null;
      if (body.guestContact !== undefined) itemUpdate.guestContact = body.guestContact?.trim() || null;
    }

    const ops: any[] = [
      db.lostFoundEvent.create({
        data: {
          itemId: item.id,
          userId: session.user.id,
          action: body.action,
          note: body.note?.trim() || null,
          meta:
            body.action === "GUEST_CONTACTED"
              ? { guestName: body.guestName ?? undefined, guestContact: body.guestContact ?? undefined }
              : undefined,
        },
      }),
    ];
    if (Object.keys(itemUpdate).length > 0) {
      ops.push(db.lostFoundItem.update({ where: { id: item.id }, data: itemUpdate }));
    }
    await db.$transaction(ops);

    logger.info(
      { itemId: item.id, actor: session.user.id, action: body.action },
      "lost-found event appended"
    );

    const [fresh, events] = await Promise.all([
      db.lostFoundItem.findUnique({ where: { id: item.id } }),
      db.lostFoundEvent.findMany({ where: { itemId: item.id }, orderBy: { createdAt: "asc" } }),
    ]);
    return NextResponse.json(await hydrateItemWithEvents(fresh!, events));
  } catch (err: any) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return NextResponse.json({ error: first?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: errorStatus(err) });
  }
}
