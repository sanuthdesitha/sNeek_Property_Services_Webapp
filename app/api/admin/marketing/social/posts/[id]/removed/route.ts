import { NextRequest, NextResponse } from "next/server";
import { markRemovalDone } from "@/lib/marketing/social/consent";
import { requireSocialRight, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

/** A person removed a flagged post on the network themselves (sNeek never claims it removed it). */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSocialRight("post");
    const done = await markRemovalDone(params.id, session.user.id);
    if (!done) return NextResponse.json({ error: "This post is not waiting to be removed." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
