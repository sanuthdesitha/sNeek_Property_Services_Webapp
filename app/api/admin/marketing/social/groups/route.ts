import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createGroup, listGroups } from "@/lib/marketing/social/groups";
import { requireSocialRight, requireSocialSession, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  format: z.enum(["SINGLE", "CAROUSEL", "BEFORE_AFTER", "FRAME"]),
  ratio: z.enum(["4:5", "1:1", "1.91:1"]).optional(),
  photoIds: z.array(z.string().min(1).max(100)).min(1).max(6),
  title: z.string().max(160).optional(),
  splitLayout: z.enum(["SIDE", "STACK", "SLIDES"]).optional(),
  frameText: z.string().max(32).optional(),
  templateKey: z.string().max(40).optional(),
}).strict();

export async function GET() {
  try {
    await requireSocialSession();
    return NextResponse.json({ groups: await listGroups() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return socialErrorResponse(error);
  }
}

/** A new DRAFT from eligible photos; captions start from the templates (no AI). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSocialRight("post");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Check the photos and the format." }, { status: 400 });
    const groupId = await createGroup(parsed.data, { userId: session.user.id, via: "USER" });
    return NextResponse.json({ groupId }, { status: 201 });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
