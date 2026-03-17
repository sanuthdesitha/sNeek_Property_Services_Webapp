import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { applyLaundryPlanDraft, buildLaundryPlanDraft } from "@/lib/laundry/planner";
import { LaundryFlag, LaundryStatus, Role } from "@prisma/client";
import { z } from "zod";

const draftItemSchema = z.object({
  jobId: z.string().trim().min(1),
  propertyId: z.string().trim().min(1),
  propertyName: z.string().trim().min(1),
  suburb: z.string().trim().default(""),
  cleanDate: z.string().datetime(),
  pickupDate: z.string().datetime(),
  dropoffDate: z.string().datetime(),
  status: z.nativeEnum(LaundryStatus),
  flagReason: z.nativeEnum(LaundryFlag).nullable(),
  flagNotes: z.string().nullable(),
  scenario: z.enum(["BACK_TO_BACK", "MICRO_CYCLE", "COMPRESSED", "FALLBACK"]),
  linenBufferSets: z.number().int().min(0),
});

const requestSchema = z.object({
  weekStart: z.string().datetime().optional(),
  approve: z.boolean().optional(),
  items: z.array(draftItemSchema).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = requestSchema.parse(await req.json().catch(() => ({})));
    const weekStart = body.weekStart ? new Date(body.weekStart) : undefined;

    if (body.approve) {
      const items = body.items ?? [];
      const applied = await applyLaundryPlanDraft(items);
      return NextResponse.json({ ok: true, appliedCount: applied.length });
    }

    const draft = await buildLaundryPlanDraft(weekStart);
    return NextResponse.json({ draft });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
