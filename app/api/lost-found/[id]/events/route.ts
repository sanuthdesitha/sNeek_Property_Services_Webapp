import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { logger } from "@/lib/logger";
import { hydrateItemWithEvents, redactItemWithEventsForReporter } from "@/lib/lost-found/service";
import { CONTACT_CHANNELS, LostFoundRuleError, recordLostFoundWorkflow } from "@/lib/lost-found/mutations";

const bodySchema = z.object({
  action: z.enum(["COMMENT", "OFFER_RETURN", "GUEST_CONTACTED", "CLIENT_CONTACTED"]),
  note: z.string().trim().max(4000).optional().nullable(),
  guestName: z.string().trim().max(180).optional().nullable(),
  guestContact: z.string().trim().max(500).optional().nullable(),
  guestEmail: z.string().trim().max(320).optional().nullable(),
  /** How the office says it made contact (the app sent nothing itself). */
  channel: z.enum(CONTACT_CHANNELS).optional().nullable(),
});

const ADMIN_ROLES: Role[] = [Role.ADMIN, Role.OPS_MANAGER];

function errorStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  if (message === "NOT_FOUND") return 404;
  return 400;
}

/**
 * POST — append a workflow event to an item's timeline.
 *  - COMMENT: anyone with access (admin/ops, or the cleaner who reported it).
 *  - OFFER_RETURN: admin/ops only → RETURN_OFFERED (through the transition table).
 *  - GUEST_CONTACTED: admin/ops only → GUEST_CONTACTED; can record the guest's
 *    name / contact / email (an office edit, guestSource MANUAL) and how the
 *    office made contact.
 *  - CLIENT_CONTACTED: admin/ops only; records that the office told the client.
 *    No status change.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
    const body = bodySchema.parse(await req.json());

    const item = await db.lostFoundItem.findUnique({ where: { id: params.id } });
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });

    const isAdmin = ADMIN_ROLES.includes(session.user.role as Role);

    if (!isAdmin) {
      // Cleaners can only COMMENT, and only on their own reports.
      if (body.action !== "COMMENT") throw new Error("FORBIDDEN");
      const settings = await getAppSettings();
      if (!isCleanerModuleEnabled(settings, "lostFound")) throw new Error("FORBIDDEN");
      if (item.reportedByUserId !== session.user.id) throw new Error("FORBIDDEN");
    }

    if (body.action === "COMMENT") {
      if (!body.note?.trim()) {
        return NextResponse.json({ error: "A comment note is required." }, { status: 400 });
      }
      await db.lostFoundEvent.create({
        data: { itemId: item.id, userId: session.user.id, action: "COMMENT", note: body.note.trim() },
      });
    } else {
      const guest =
        body.action === "GUEST_CONTACTED" && (body.guestName !== undefined || body.guestContact !== undefined || body.guestEmail !== undefined)
          ? { guestName: body.guestName, guestContact: body.guestContact, guestEmail: body.guestEmail }
          : undefined;
      await recordLostFoundWorkflow(item.id, session.user.id, { action: body.action, note: body.note, guest, channel: body.channel ?? null });
    }

    logger.info({ itemId: item.id, actor: session.user.id, action: body.action }, "lost-found event appended");

    const [fresh, events] = await Promise.all([
      db.lostFoundItem.findUnique({ where: { id: item.id } }),
      db.lostFoundEvent.findMany({ where: { itemId: item.id }, orderBy: { createdAt: "asc" } }),
    ]);
    const detail = await hydrateItemWithEvents(fresh!, events);
    return NextResponse.json(isAdmin ? detail : redactItemWithEventsForReporter(detail, events, session.user.id));
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return NextResponse.json({ error: first?.message ?? "Invalid request." }, { status: 400 });
    }
    if (err instanceof LostFoundRuleError) return NextResponse.json({ error: err.message }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not record this." }, { status: errorStatus(err) });
  }
}
