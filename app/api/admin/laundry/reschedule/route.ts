import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { rescheduleLaundryRuns } from "@/lib/laundry/reschedule";

const schema = z.object({
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z
    .array(z.object({ id: z.string().trim().min(1).max(128), expectedUpdatedAt: z.string().datetime() }))
    .min(1)
    .max(100),
});

/**
 * POST /api/admin/laundry/reschedule { toDate, rows: [{ id, expectedUpdatedAt }] }
 * Moves one or several runs to a day. Each row is checked against the version
 * the screen saw and answers done or refused (with the reason); a run changed
 * since is refused, never overwritten.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Choose runs and a valid day." }, { status: 400 });
    const results = await rescheduleLaundryRuns(parsed.data.rows, parsed.data.toDate, session.user.id);
    return NextResponse.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not move the runs.";
    return NextResponse.json({ error: message }, { status: getApiErrorStatus(err) });
  }
}
