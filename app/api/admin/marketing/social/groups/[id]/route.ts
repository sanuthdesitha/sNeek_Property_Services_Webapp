import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cancelGroup, loadGroupView, updateGroup } from "@/lib/marketing/social/groups";
import { requireSocialRight, requireSocialSession, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const dynamic = "force-dynamic";

const network = z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "GOOGLE_BUSINESS", "LINKEDIN"]);
const patchSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  title: z.string().max(160).optional(),
  format: z.enum(["SINGLE", "CAROUSEL", "BEFORE_AFTER", "FRAME"]).optional(),
  ratio: z.enum(["4:5", "1:1", "1.91:1"]).optional(),
  photoIds: z.array(z.string().min(1).max(100)).min(1).max(6).optional(),
  splitLayout: z.enum(["SIDE", "STACK", "SLIDES"]).nullable().optional(),
  frameText: z.string().max(32).nullable().optional(),
  altText: z.record(z.string().max(100), z.string().max(1000)).optional(),
  beforeChecked: z.array(z.string().max(100)).max(6).optional(),
  captions: z.record(network, z.object({ caption: z.string().max(10000), hashtags: z.array(z.string().regex(new RegExp("^#[\\p{L}\\p{N}_]{2,60}$", "u"))).max(30).optional() }).strict()).optional(),
  regenerateCaptions: z.object({ templateKey: z.string().max(40).nullable(), hookIndex: z.number().int().min(0).max(100), networks: z.array(network).optional() }).strict().optional(),
}).strict();

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSocialSession();
    const group = await loadGroupView(params.id);
    if (!group) return NextResponse.json({ error: "This post no longer exists. Its permission may have been revoked." }, { status: 404 });
    return NextResponse.json({ group }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return socialErrorResponse(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSocialRight("post");
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Some changes could not be read.", problems: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
    await updateGroup(params.id, parsed.data, session.user.id);
    return NextResponse.json({ group: await loadGroupView(params.id) });
  } catch (error) {
    return socialErrorResponse(error);
  }
}

/** Cancels a draft (its cleaned copies are deleted). A post that went out is a record and stays. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSocialRight("post");
    await cancelGroup(params.id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
