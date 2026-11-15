import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordManualPost } from "@/lib/marketing/social/publish";
import { requireSocialRight, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

const schema = z.object({ url: z.string().max(2000) }).strict();

/** "Posted by you": the link of a post the person made themselves (the fallback). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSocialRight("post");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Paste the full link to the post." }, { status: 400 });
    await recordManualPost({ postId: params.id, url: parsed.data.url.trim(), actorId: session.user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
