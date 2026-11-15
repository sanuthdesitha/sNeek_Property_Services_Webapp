import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { socialTemplatesSchema } from "@/lib/marketing/social/captions";
import { getSocialTemplates, saveSocialTemplates, TemplatesConflictError } from "@/lib/marketing/social/templates-store";
import { requireSocialRight, requireSocialSession, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const dynamic = "force-dynamic";

const putSchema = z.object({ expectedRevision: z.number().int().nonnegative(), templates: socialTemplatesSchema.omit({ revision: true }) }).strict();

export async function GET() {
  try {
    await requireSocialSession();
    return NextResponse.json(await getSocialTemplates(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return socialErrorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSocialRight("post");
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Some template fields are not valid.", problems: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
    const templates = await saveSocialTemplates({ ...parsed.data, actorId: session.user.id });
    return NextResponse.json({ templates });
  } catch (error) {
    if (error instanceof TemplatesConflictError) return NextResponse.json({ error: error.message, current: error.current }, { status: 409 });
    return socialErrorResponse(error);
  }
}
