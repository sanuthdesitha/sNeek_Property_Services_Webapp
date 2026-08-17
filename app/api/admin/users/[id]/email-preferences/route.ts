import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EMAIL_AUTO_KIND_KEYS } from "@/lib/notifications/email-kinds";

/**
 * One person's automatic-email switches, all of them, in one place.
 *
 * The bulk route (../../email-preferences/bulk) can only apply ONE kind to many
 * people at a time, which meant answering "what is this person actually
 * receiving?" required reading a count badge and guessing. This returns and
 * accepts the whole set for a single user, so the admin UI can show a grid.
 *
 * STORAGE RULE, which the write path depends on: a `UserEmailPreference` row
 * records a DEVIATION, so absence means allowed. Re-enabling a kind DELETES its
 * row rather than storing `enabled: true` — that way a kind added to the
 * registry later defaults to on for everybody, instead of silently inheriting
 * whatever stale rows happened to exist.
 *
 * `allEmailOff` is deliberately a separate flag rather than "every kind off":
 * it keeps meaning "stop emailing me" as new kinds are added, which a snapshot
 * of per-kind rows could not. Auth and recovery mail sends as `critical` and
 * bypasses both.
 */

const putSchema = z.object({
  /** Kinds this person should NOT receive. Anything absent is allowed. */
  disabledKinds: z.array(z.enum(EMAIL_AUTO_KIND_KEYS as [string, ...string[]])),
  allEmailOff: z.boolean(),
});

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: "Could not update email preferences." }, { status: 400 });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const user = await db.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        allEmailOff: true,
        emailPreferences: { where: { enabled: false }, select: { key: true } },
      },
    });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      allEmailOff: user.allEmailOff,
      disabledKinds: user.emailPreferences.map((row) => row.key),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }
    const body = putSchema.parse(payload);

    const user = await db.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        allEmailOff: true,
        emailPreferences: { where: { enabled: false }, select: { key: true } },
      },
    });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Captured before the write so the audit entry can show what changed, not
    // just what it ended up as — "I never got the email" is answered by the
    // before/after pair, not by the final state alone.
    const previous = {
      disabledKinds: user.emailPreferences.map((row) => row.key),
      allEmailOff: user.allEmailOff,
    };

    const disabled = Array.from(new Set(body.disabledKinds));
    const enabled = EMAIL_AUTO_KIND_KEYS.filter((key) => !disabled.includes(key));

    await db.$transaction(async (tx) => {
      // Deleting the re-enabled rows rather than setting enabled:true keeps the
      // "absence means allowed" invariant the send path relies on.
      await tx.userEmailPreference.deleteMany({
        where: { userId: params.id, key: { in: enabled } },
      });

      for (const key of disabled) {
        await tx.userEmailPreference.upsert({
          where: { userId_key: { userId: params.id, key } },
          create: { userId: params.id, key, enabled: false },
          update: { enabled: false },
        });
      }

      await tx.user.update({
        where: { id: params.id },
        data: { allEmailOff: body.allEmailOff },
      });
    });

    // Audited: silencing someone's mail is the kind of change that later gets
    // reported as "I never got the email".
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "USER_EMAIL_PREFERENCES_SET",
        entity: "User",
        entityId: params.id,
        before: previous as never,
        after: { disabledKinds: disabled, allEmailOff: body.allEmailOff } as never,
      },
    });

    return NextResponse.json({ disabledKinds: disabled, allEmailOff: body.allEmailOff });
  } catch (err) {
    return errorResponse(err);
  }
}
