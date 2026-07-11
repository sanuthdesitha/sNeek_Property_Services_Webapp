import { NextRequest, NextResponse } from "next/server";
import { Role, type LostFoundStatus } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { logger } from "@/lib/logger";
import { hydrateItemWithEvents } from "@/lib/lost-found/service";
import { LOST_FOUND_STATUSES, isResolvedStatus } from "@/lib/lost-found/status";

const patchSchema = z.object({
  status: z.enum(LOST_FOUND_STATUSES).optional(),
  guestName: z.string().trim().max(180).optional().nullable(),
  guestContact: z.string().trim().max(500).optional().nullable(),
  estimatedValue: z.number().finite().nonnegative().max(1_000_000).optional().nullable(),
  resolution: z.string().trim().max(4000).optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable(),
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
    const { item } = await loadWithAccess(params.id, "view");
    const events = await db.lostFoundEvent.findMany({
      where: { itemId: item.id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(await hydrateItemWithEvents(item, events));
  } catch (err: any) {
    const status = err?.message === "NOT_FOUND" ? 404 : errorStatus(err);
    return NextResponse.json({ error: err.message }, { status });
  }
}

/**
 * PATCH — admin/ops workflow control: change status (IN_STORAGE / GUEST_CONTACTED /
 * RETURN_OFFERED / REPORTED / ARCHIVED), record guest name/contact + estimated value,
 * or record the final decision. Resolution statuses (RETURNED / DISPOSED / DONATED /
 * UNCLAIMED) stamp resolvedAt + resolvedByUserId + resolution.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { session, item } = await loadWithAccess(params.id, "manage");
    const body = patchSchema.parse(await req.json());

    const data: Record<string, unknown> = {};
    let touched = false;

    if (body.guestName !== undefined) {
      data.guestName = body.guestName?.trim() || null;
      touched = true;
    }
    if (body.guestContact !== undefined) {
      data.guestContact = body.guestContact?.trim() || null;
      touched = true;
    }
    if (body.estimatedValue !== undefined) {
      data.estimatedValue = body.estimatedValue ?? null;
      touched = true;
    }

    const statusChanged = body.status !== undefined && body.status !== item.status;
    const resolving = body.status !== undefined && isResolvedStatus(body.status);

    if (body.status !== undefined) {
      data.status = body.status as LostFoundStatus;
      touched = true;
      if (resolving) {
        data.resolvedAt = new Date();
        data.resolvedByUserId = session.user.id;
        data.resolution = body.resolution?.trim() || body.note?.trim() || item.resolution || null;
      } else {
        // Moving to a workflow / archived status clears any prior resolution stamp.
        if (item.resolvedAt) {
          data.resolvedAt = null;
          data.resolvedByUserId = null;
        }
        if (body.resolution !== undefined) data.resolution = body.resolution?.trim() || null;
      }
    } else if (body.resolution !== undefined) {
      data.resolution = body.resolution?.trim() || null;
      touched = true;
    }

    if (!touched) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    // Timeline event: use the decision action for resolutions, else STATUS_CHANGE.
    const action = resolving ? (body.status as string) : "STATUS_CHANGE";
    const noteText =
      body.note?.trim() ||
      (resolving ? body.resolution?.trim() : null) ||
      (statusChanged ? null : "Details updated") ||
      null;

    const [updated] = await db.$transaction([
      db.lostFoundItem.update({ where: { id: item.id }, data }),
      db.lostFoundEvent.create({
        data: {
          itemId: item.id,
          userId: session.user.id,
          action,
          note: noteText,
          meta: {
            fromStatus: item.status,
            toStatus: body.status ?? item.status,
            guestName: body.guestName ?? undefined,
            guestContact: body.guestContact ?? undefined,
          },
        },
      }),
    ]);

    logger.info(
      { itemId: item.id, actor: session.user.id, action, toStatus: updated.status },
      "lost-found item updated"
    );

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
    const status = err?.message === "NOT_FOUND" ? 404 : errorStatus(err);
    return NextResponse.json({ error: err.message }, { status });
  }
}
