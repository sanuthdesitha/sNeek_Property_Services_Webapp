import { NextRequest, NextResponse } from "next/server";
import { Role, type LostFoundStatus } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { logger } from "@/lib/logger";
import { hydrateItemWithEvents, redactItemWithEventsForReporter } from "@/lib/lost-found/service";
import { LOST_FOUND_STATUSES } from "@/lib/lost-found/status";
import { applyLostFoundChange, LostFoundRuleError, type DetailChange, type ItemChange } from "@/lib/lost-found/mutations";

const patchSchema = z.object({
  status: z.enum(LOST_FOUND_STATUSES).optional(),
  guestName: z.string().trim().max(180).optional().nullable(),
  guestContact: z.string().trim().max(500).optional().nullable(),
  estimatedValue: z.number().finite().nonnegative().max(1_000_000).optional().nullable(),
  resolution: z.string().trim().max(4000).optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable(),
  guestEmail: z.string().trim().max(320).optional().nullable(),
  storageLocation: z.string().trim().max(200).optional().nullable(),
  reservationId: z.string().trim().min(1).max(64).optional(),
  reopenReason: z.string().trim().max(2000).optional().nullable(),
});

function errorStatus(err: any): number {
  if (err?.message === "UNAUTHORIZED") return 401;
  if (err?.message === "FORBIDDEN") return 403;
  return 400;
}

const ADMIN_ROLES = [Role.ADMIN, Role.OPS_MANAGER];

/**
 * Loads the item and enforces access: ADMIN / OPS_MANAGER see everything;
 * a CLEANER may only touch items they reported (and only while the module is on).
 */
async function loadWithAccess(id: string, mode: "view" | "manage") {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
  const item = await db.lostFoundItem.findUnique({ where: { id } });
  if (!item) throw new Error("NOT_FOUND");

  const isAdmin = ADMIN_ROLES.includes(session.user.role as any);
  if (!isAdmin) {
    // Cleaner path — manage actions beyond commenting are admin-only.
    if (mode === "manage") throw new Error("FORBIDDEN");
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "lostFound")) throw new Error("FORBIDDEN");
    if (item.reportedByUserId !== session.user.id) throw new Error("FORBIDDEN");
  }
  return { session, item, isAdmin };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { item, isAdmin, session } = await loadWithAccess(params.id, "view");
    const events = await db.lostFoundEvent.findMany({
      where: { itemId: item.id },
      orderBy: { createdAt: "asc" },
    });
    const detail = await hydrateItemWithEvents(item, events);
    return NextResponse.json(isAdmin ? detail : redactItemWithEventsForReporter(detail, events, session.user.id));
  } catch (err: any) {
    const status = err?.message === "NOT_FOUND" ? 404 : errorStatus(err);
    return NextResponse.json({ error: err.message }, { status });
  }
}

/**
 * PATCH — office workflow control (ADMIN / OPS_MANAGER):
 *  - status: through the transition table (lib/lost-found/transitions.ts);
 *    a closed item goes back to an open status only with `reopenReason`;
 *    final decisions stamp resolvedAt / resolvedByUserId / resolution.
 *  - guestName / guestContact / guestEmail: an office edit (guestSource MANUAL).
 *  - reservationId: take the guest from another booking at this property.
 *  - estimatedValue, storageLocation, resolution, note.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { session, item } = await loadWithAccess(params.id, "manage");
    const body = patchSchema.parse(await req.json());

    const details: DetailChange = {};
    if (body.guestName !== undefined) details.guestName = body.guestName;
    if (body.guestContact !== undefined) details.guestContact = body.guestContact;
    if (body.guestEmail !== undefined) details.guestEmail = body.guestEmail;
    if (body.estimatedValue !== undefined) details.estimatedValue = body.estimatedValue ?? null;
    if (body.storageLocation !== undefined) details.storageLocation = body.storageLocation;
    if (body.reservationId) details.reservationId = body.reservationId;

    const change: ItemChange = {};
    if (Object.keys(details).length) change.details = details;
    if (body.status !== undefined) {
      change.status = { status: body.status as LostFoundStatus, resolution: body.resolution, note: body.note, reopenReason: body.reopenReason };
    } else if (body.resolution !== undefined) {
      // A resolution note on its own edits the note of the current status.
      change.status = { status: item.status, resolution: body.resolution, note: body.note };
    }
    if (!change.details && !change.status) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const updated = await applyLostFoundChange(item.id, session.user.id, change);
    logger.info({ itemId: item.id, actor: session.user.id, toStatus: updated.status }, "lost-found item updated");

    const events = await db.lostFoundEvent.findMany({
      where: { itemId: item.id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(await hydrateItemWithEvents(updated, events));
  } catch (err: any) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return NextResponse.json({ error: first?.message ?? "Invalid request." }, { status: 400 });
    }
    if (err instanceof LostFoundRuleError) return NextResponse.json({ error: err.message }, { status: 409 });
    const status = err?.message === "NOT_FOUND" ? 404 : errorStatus(err);
    return NextResponse.json({ error: err.message }, { status });
  }
}
