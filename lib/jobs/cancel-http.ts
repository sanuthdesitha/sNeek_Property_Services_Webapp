import "server-only";
/** Shared request parsing and error answers for the cancel / restore routes. */
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { canActAs } from "@/lib/auth/roles";
import { CANCEL_REASON_MAX } from "./cancel-rules";
import { JobCancelError, type CancelActor } from "./cancel";

export const cancelBodySchema = z
  .object({
    reason: z.string().trim().min(1, "Give a reason for cancelling.").max(CANCEL_REASON_MAX),
    expectedUpdatedAt: z.string().datetime().optional(),
    /** false = do not notify the released cleaners (default: inbox notice). */
    notify: z.boolean().optional(),
  })
  .strict();

export const restoreBodySchema = z
  .object({
    /** Restore even though the slot check found conflicts (explicit override). */
    confirmConflicts: z.boolean().optional(),
    /** Cleaners the office chose to leave off instead of overriding. */
    skipUserIds: z.array(z.string().min(1).max(128)).max(50).optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .strict();

type SessionLike = { user: { id: string; role: Role; heldRoles?: Role[] }; impersonation?: { actorId: string } };

/** The acting user, whether they hold ADMIN (the live held roles), and the admin behind a "test as". */
export function cancelActor(session: SessionLike): CancelActor {
  const held = (session.user.heldRoles ?? [session.user.role]) as Role[];
  return { id: session.user.id, isAdmin: canActAs(held, [Role.ADMIN]), impersonatedBy: session.impersonation?.actorId ?? null };
}

export function cancelFailure(err: unknown, fallback: string) {
  if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  if (err instanceof JobCancelError) return NextResponse.json({ error: err.message, code: err.code ?? null }, { status: err.status });
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
