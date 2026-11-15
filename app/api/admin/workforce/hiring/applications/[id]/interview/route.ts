import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveInterview } from "@/lib/hiring/hire";
import { hiringErrorResponse, NO_STORE, requireHiringWriter } from "@/lib/hiring/route-helpers";

const score = z.union([z.number().int().min(1).max(5), z.null()]).optional();
const bodySchema = z.object({
  interviewDate: z.string().max(40).nullable(),
  interviewNotes: z.string().max(8000).nullable(),
  scores: z.object({ reliability: score, detail: score, communication: score }).default({}),
});

/** PUT — interview date, notes and the optional internal scores (never shown to the candidate). */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { creator } = await requireHiringWriter();
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Scores are whole numbers from 1 to 5, or empty." }, { status: 400, headers: NO_STORE });
    await saveInterview({ applicationId: params.id, actorId: creator.id, ...parsed.data });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return hiringErrorResponse(error, "Could not save the interview notes.");
  }
}
