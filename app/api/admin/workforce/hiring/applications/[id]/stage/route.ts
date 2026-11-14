import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { moveApplicationStage } from "@/lib/hiring/hire";
import { hiringErrorResponse, NO_STORE, requireHiringWriter } from "@/lib/hiring/route-helpers";

const bodySchema = z.object({
  to: z.enum(["NEW", "SCREENING", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"]),
  expectedFrom: z.string().max(20).optional(),
  offer: z
    .object({
      roleTitle: z.string().trim().max(160).optional(),
      rate: z.string().trim().max(80).optional(),
      startDate: z.string().trim().max(80).optional(),
      accountRole: z.string().trim().max(40).optional(),
    })
    .optional(),
  rejectionReason: z.string().trim().max(500).optional(),
});

/**
 * POST — move an application to another stage (board drag, the keyboard
 * "Move to…" menu, Make an offer, Decline). Never sends an email: the page
 * shows the stage's email preview first and sends it through the email route
 * only when the person presses Send. Hired is refused here (account step).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { creator } = await requireHiringWriter();
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a stage." }, { status: 400, headers: NO_STORE });
    const result = await moveApplicationStage({
      applicationId: params.id,
      actorId: creator.id,
      to: parsed.data.to,
      expectedFrom: parsed.data.expectedFrom ?? null,
      offer: parsed.data.offer ?? null,
      rejectionReason: parsed.data.rejectionReason ?? null,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return hiringErrorResponse(error, "Could not move the application.");
  }
}
