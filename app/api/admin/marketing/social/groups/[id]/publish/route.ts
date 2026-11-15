import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { testingAsRefusal } from "@/lib/marketing/social/access";
import { loadGroupView } from "@/lib/marketing/social/groups";
import { publishGroup } from "@/lib/marketing/social/publish";
import { requireSocialRight, socialErrorResponse, socialHttp } from "@/lib/marketing/social/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  networks: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "GOOGLE_BUSINESS", "LINKEDIN"])).min(1).max(5),
  retry: z.boolean().optional(),
  /** Retry of a network whose result was not confirmed: the person checked it is not there. */
  confirmNotPosted: z.boolean().optional(),
}).strict();

/**
 * One reviewed click (after the tier A confirmation naming every
 * destination). Refused while testing as someone. Every check runs again on
 * the server; results are what each network answered.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSocialRight("post");
    const testing = testingAsRefusal(session);
    if (testing) return NextResponse.json({ error: testing, code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose at least one network." }, { status: 400 });
    const network = socialHttp();
    const results = await publishGroup(
      { groupId: params.id, networks: parsed.data.networks, actorId: session.user.id, trigger: parsed.data.retry ? "RETRY" : "CLICK", confirmNotPosted: parsed.data.confirmNotPosted },
      { http: network.http, publicBase: network.publicBase },
    );
    return NextResponse.json({ results, group: await loadGroupView(params.id), stubbed: network.stubbed });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
