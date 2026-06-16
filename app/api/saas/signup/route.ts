import { NextRequest, NextResponse } from "next/server";
import { signupNewWorkspace, signupSchema } from "@/lib/saas/signup";
import { SIGNUP_ENABLED } from "@/lib/saas/config";

/**
 * Public self-serve workspace signup. GATED behind SNEEK_SIGNUP: it stays 404
 * until tenant isolation (Phase 1b) is live and leak-audited, so it can never
 * mint an un-isolated ADMIN into the shared workspace.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!SIGNUP_ENABLED) {
    return NextResponse.json({ error: "Signup is not enabled yet." }, { status: 404 });
  }
  try {
    const parsed = signupSchema.parse(await req.json());
    const result = await signupNewWorkspace(parsed);
    return NextResponse.json(
      {
        ok: true,
        organizationId: result.organizationId,
        slug: result.slug,
        trialEndsAt: result.trialEndsAt,
      },
      { status: 201 }
    );
  } catch (err: any) {
    if (err?.message === "EMAIL_TAKEN") {
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    if (err?.name === "ZodError") {
      return NextResponse.json({ error: "Please check the form and try again." }, { status: 400 });
    }
    return NextResponse.json({ error: err?.message ?? "Signup failed." }, { status: 400 });
  }
}
