import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EMAIL_AUTO_KIND_KEYS } from "@/lib/notifications/email-kinds";

const bodySchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(500),
  /** "Stop emailing these people entirely" (auth/recovery mail still sends). */
  allEmailOff: z.boolean().optional(),
  /** kind -> allowed. Absent kinds are left exactly as they are. */
  kinds: z.record(z.boolean()).optional(),
});

/**
 * Set email preferences for a group of people at once.
 *
 * Read/modify semantics matter here: a request only touches the kinds it
 * names, so ticking one box for a selection does not quietly reset every other
 * preference those people had. And "allowed" DELETES the row rather than
 * storing `true` — the table records deviations only, so an absent row keeps
 * meaning "follows the global setting", and a kind added next month arrives
 * allowed instead of already-decided for everyone.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    // Unknown kinds are dropped rather than rejected: a stale browser tab
    // shouldn't fail the whole save for the kinds it does know about.
    const entries = Object.entries(body.kinds ?? {}).filter(([key]) =>
      (EMAIL_AUTO_KIND_KEYS as string[]).includes(key)
    );

    const users = await db.user.findMany({
      where: { id: { in: body.userIds } },
      select: { id: true },
    });
    if (users.length === 0) {
      return NextResponse.json({ error: "No matching people." }, { status: 404 });
    }
    const userIds = users.map((u) => u.id);

    if (typeof body.allEmailOff === "boolean") {
      await db.user.updateMany({
        where: { id: { in: userIds } },
        data: { allEmailOff: body.allEmailOff },
      });
    }

    const disabled = entries.filter(([, enabled]) => !enabled).map(([key]) => key);
    const enabled = entries.filter(([, isOn]) => isOn).map(([key]) => key);

    if (disabled.length > 0) {
      // Not createMany+skipDuplicates: a person may already have a row for this
      // kind set to enabled, and that row has to flip rather than be skipped.
      await db.$transaction(
        userIds.flatMap((userId) =>
          disabled.map((key) =>
            db.userEmailPreference.upsert({
              where: { userId_key: { userId, key } },
              create: { userId, key, enabled: false },
              update: { enabled: false },
            })
          )
        )
      );
    }
    if (enabled.length > 0) {
      await db.userEmailPreference.deleteMany({
        where: { userId: { in: userIds }, key: { in: enabled } },
      });
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "USER_EMAIL_PREFERENCES_BULK",
        entity: "UserEmailPreference",
        entityId: userIds[0],
        after: {
          affected: userIds.length,
          allEmailOff: body.allEmailOff ?? null,
          disabled,
          enabled,
        } as any,
      },
    });

    return NextResponse.json({ ok: true, affected: userIds.length });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: err.message ?? "Could not update email preferences." },
      { status }
    );
  }
}

/** The current per-person overrides, so the admin UI can show what is set. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [rows, offUsers] = await Promise.all([
      db.userEmailPreference.findMany({
        where: { enabled: false },
        select: { userId: true, key: true },
      }),
      db.user.findMany({ where: { allEmailOff: true }, select: { id: true } }),
    ]);

    const byUser: Record<string, string[]> = {};
    for (const row of rows) {
      (byUser[row.userId] ??= []).push(row.key);
    }
    return NextResponse.json({ disabledKinds: byUser, allEmailOff: offUsers.map((u) => u.id) });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
