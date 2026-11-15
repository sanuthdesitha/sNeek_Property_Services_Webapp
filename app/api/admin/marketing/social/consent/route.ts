import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listConsentRegister, recordConsent } from "@/lib/marketing/social/consent";
import { officeConsentInput, officeConsentProblem } from "@/lib/marketing/social/consent-rules";
import { requireSocialRight, requireSocialSession, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const dynamic = "force-dynamic";

/** The marketing permission register, plus the clients and properties the record dialog offers. */
export async function GET() {
  try {
    await requireSocialSession();
    const [register, clients] = await Promise.all([
      listConsentRegister(),
      db.client.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 1000, select: { id: true, name: true, properties: { where: { isActive: true }, select: { id: true, name: true, suburb: true }, orderBy: { name: "asc" } } } }),
    ]);
    return NextResponse.json({ register, clients }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return socialErrorResponse(error);
  }
}

/**
 * Records a permission the office was given by signed form, email or phone
 * (tier A). ADMIN, or OPS_MANAGER with Clients and Marketing at Manage.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSocialRight("consent");
    if (session.impersonation) return NextResponse.json({ error: "Stop testing as someone else to record a permission." }, { status: 403 });
    const parsed = officeConsentInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Check the client, properties and how it was given." }, { status: 400 });
    const problem = officeConsentProblem(parsed.data);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (parsed.data.evidenceS3Key && !/^marketing-consent\/[A-Za-z0-9/_.-]+$/.test(parsed.data.evidenceS3Key)) return NextResponse.json({ error: "Attach the evidence again." }, { status: 400 });
    const result = await recordConsent({ ...parsed.data, recordedById: session.user.id }, { userId: session.user.id, via: "OFFICE" });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
