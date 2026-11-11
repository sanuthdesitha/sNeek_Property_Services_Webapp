import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { CASE_STATUSES } from "@/lib/cases/status";
import { runCaseBulk } from "@/lib/cases/bulk";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    ids: z.array(z.string().trim().min(1).max(128)).min(1).max(100),
    assignedToUserId: z.string().trim().min(1).nullable(),
  }),
  z.object({
    action: z.literal("status"),
    ids: z.array(z.string().trim().min(1).max(128)).min(1).max(100),
    status: z.enum(CASE_STATUSES),
    note: z.string().trim().max(4000),
  }),
  z.object({
    action: z.literal("close"),
    ids: z.array(z.string().trim().min(1).max(128)).min(1).max(100),
    note: z.string().trim().max(4000),
  }),
]);

/**
 * POST /api/admin/cases/bulk — assign, change status or close several cases.
 * Each case goes through the same single-case rules (applyCaseUpdate): a status
 * change needs a note, and every row reports its own outcome (done or refused
 * with the reason). Nothing is reported done that was not saved.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose cases and a valid bulk action." }, { status: 400 });
    }
    const results = await runCaseBulk(parsed.data, {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    });
    return NextResponse.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not run the bulk action.";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 },
    );
  }
}
