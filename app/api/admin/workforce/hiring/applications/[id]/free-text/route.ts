import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markFreeTextAnswer } from "@/lib/hiring/hire";
import { hiringErrorResponse, NO_STORE, requireHiringWriter } from "@/lib/hiring/route-helpers";

const bodySchema = z.object({ answerId: z.string().trim().min(1).max(120), verdict: z.enum(["right", "wrong"]) });

/** POST — a reviewer's call on one free-text knowledge-test answer (kept beside the score). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { creator } = await requireHiringWriter();
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose right or wrong." }, { status: 400, headers: NO_STORE });
    await markFreeTextAnswer({ applicationId: params.id, actorId: creator.id, ...parsed.data });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return hiringErrorResponse(error, "Could not record the review.");
  }
}
