import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { saveCleanerAvailability } from "@/lib/accounts/availability";

const slotSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const schema = z.object({
  mode: z.enum(["FIXED", "FLEXIBLE"]).optional(),
  weekly: z.record(z.string(), z.array(slotSchema)).optional(),
  dateOverrides: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.array(slotSchema)).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const saved = await saveCleanerAvailability(params.userId, body);
    return NextResponse.json(saved);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update availability." }, { status });
  }
}

