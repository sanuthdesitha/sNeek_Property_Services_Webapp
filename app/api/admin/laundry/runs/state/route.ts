import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireCapability } from "@/lib/rbac/can";
import { CHANGE_STATE_TARGETS } from "@/lib/laundry/run-correction-rules";
import { changeLaundryRunState, changeLaundryRunStates } from "@/lib/laundry/run-corrections";
import { correctionActor, runCorrectionErrorResponse, RUN_CORRECTION_HEADERS } from "@/lib/laundry/run-corrections-http";

export const dynamic = "force-dynamic";

const item = z.object({ taskId: z.string().trim().min(1).max(200), expectedUpdatedAt: z.string().datetime() });
const bodySchema = z.object({
  items: z.array(item).min(1).max(50),
  target: z.enum(CHANGE_STATE_TARGETS),
  happenedAt: z.string().datetime().nullable().optional(),
  pickedUpAt: z.string().datetime().nullable().optional(),
  doneById: z.string().trim().min(1).max(200).nullable().optional(),
  reason: z.string().trim().min(3).max(2000),
  skipReasonCode: z.string().trim().max(60).nullable().optional(),
  flagNote: z.string().trim().max(2000).nullable().optional(),
  bagCount: z.number().int().min(1).max(50).nullable().optional(),
  weightKg: z.number().positive().max(500).nullable().optional(),
  price: z.number().positive().max(100000).nullable().optional(),
  acknowledgeBackwards: z.boolean().optional(),
  notifyTeam: z.boolean().optional(),
}).strict();

/**
 * POST — Change state (one run, or several with one state and one real time).
 * ADMIN, and OPS_MANAGER with the Laundry pack at manage (capability
 * laundry.change_state). Each run is checked against the version shown and
 * answers with its own outcome; a single run answers with the full result.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await requireCapability(session, "laundry.change_state");
    const body = bodySchema.parse(await req.json());
    const { items, ...request } = body;
    const actor = correctionActor(session);
    if (items.length === 1) {
      const result = await changeLaundryRunState(actor, { ...request, ...items[0] });
      return NextResponse.json({ ok: true, result }, { headers: RUN_CORRECTION_HEADERS });
    }
    const outcomes = await changeLaundryRunStates(actor, items, request);
    return NextResponse.json({ ok: true, outcomes }, { headers: RUN_CORRECTION_HEADERS });
  } catch (error) {
    return runCorrectionErrorResponse(error);
  }
}
