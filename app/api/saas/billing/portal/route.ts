import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { BILLING_ENABLED } from "@/lib/saas/config";
import { createBillingPortalSession } from "@/lib/saas/billing";
import { runAsPlatformAdmin } from "@/lib/saas/tenant-context";

function baseUrl(): string {
  return (process.env.APP_BASE_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || "").replace(/\/+$/, "");
}

/** Open the Stripe Customer Portal for the signed-in admin's organization. */
export async function POST(_req: NextRequest) {
  if (!BILLING_ENABLED) {
    return NextResponse.json({ error: "Billing is not enabled." }, { status: 404 });
  }
  try {
    const session = await requireRole([Role.ADMIN]);
    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No organization on this account." }, { status: 400 });
    }
    const org = await runAsPlatformAdmin(() =>
      db.organization.findUnique({ where: { id: organizationId }, select: { stripeCustomerId: true } })
    );
    if (!org?.stripeCustomerId) {
      return NextResponse.json({ error: "No billing account yet." }, { status: 400 });
    }
    const { url } = await createBillingPortalSession({
      customerId: org.stripeCustomerId,
      returnUrl: `${baseUrl()}/admin`,
    });
    return NextResponse.json({ url });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
