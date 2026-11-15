import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { testingAsRefusal } from "@/lib/marketing/social/access";
import { loadGroupView } from "@/lib/marketing/social/groups";
import { planGroup, unplanGroup } from "@/lib/marketing/social/publish";
import { requireSocialRight, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

const schema = z.object({
  plannedFor: z.string().datetime().nullable(),
  networks: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "GOOGLE_BUSINESS", "LINKEDIN"])).max(5),
}).strict();

/**
 * Plans the post for a time (connected networks are posted by sNeek then,
 * re-checked first; the others wait for your link), or clears the plan.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSocialRight("post");
    const testing = testingAsRefusal(session);
    if (testing) return NextResponse.json({ error: testing, code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Check the planned time." }, { status: 400 });
    if (parsed.data.plannedFor === null) {
      await unplanGroup(params.id, session.user.id);
      return NextResponse.json({ plan: [], group: await loadGroupView(params.id) });
    }
    const plan = await planGroup({ groupId: params.id, plannedFor: new Date(parsed.data.plannedFor), networks: parsed.data.networks, actorId: session.user.id });
    return NextResponse.json({ plan, group: await loadGroupView(params.id) });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
