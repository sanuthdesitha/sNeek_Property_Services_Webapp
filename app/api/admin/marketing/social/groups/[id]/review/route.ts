import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadGroupView, markReviewed } from "@/lib/marketing/social/groups";
import { requireSocialRight, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

const schema = z.object({ expectedRevision: z.number().int().nonnegative(), reviewed: z.boolean() }).strict();

/** "I looked at every photo": the person and the time, for the revision on screen. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSocialRight("post");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await markReviewed(params.id, session.user.id, parsed.data.expectedRevision, parsed.data.reviewed);
    return NextResponse.json({ group: await loadGroupView(params.id) });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
