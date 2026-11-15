import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ConsentError, recordConsent, revokeConsent } from "@/lib/marketing/social/consent";
import { portalConsentInput } from "@/lib/marketing/social/consent-rules";

export const dynamic = "force-dynamic";

/**
 * The client's own marketing permission (portal). Only CLIENT logins act for
 * their own client and only their own properties. Refused while an
 * administrator is testing as the client: a permission is the owner's own word.
 */
async function ownClient(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, clientId: true } });
  if (!user?.clientId) throw new ConsentError(403, "This login is not linked to a client.");
  return user as { id: string; name: string | null; email: string | null; clientId: string };
}

async function state(clientId: string) {
  const [properties, current] = await Promise.all([
    db.property.findMany({ where: { clientId, isActive: true }, select: { id: true, name: true, suburb: true }, orderBy: { name: "asc" } }),
    db.marketingConsent.findFirst({ where: { clientId, endedAt: null }, include: { properties: true } }),
  ]);
  return {
    properties,
    consent: current ? { allowSuburb: current.allowSuburb, allowBefore: current.allowBefore, givenAt: current.givenAt.toISOString(), givenByName: current.givenByName, method: current.method, propertyIds: current.properties.map((row) => row.propertyId) } : null,
  };
}

export async function GET() {
  try {
    const session = await requireRole([Role.CLIENT]);
    const user = await ownClient(session.user.id);
    return NextResponse.json(await state(user.clientId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConsentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Your choice could not be loaded." }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLIENT]);
    if (session.impersonation) return NextResponse.json({ error: "Only the client can change this. Stop testing as them." }, { status: 403 });
    const user = await ownClient(session.user.id);
    const parsed = portalConsentInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid choice." }, { status: 400 });
    if (!parsed.data.allow) {
      const cascade = await revokeConsent(user.clientId, { userId: user.id, via: "PORTAL" }, "Turned off by the client in the portal");
      return NextResponse.json({ ...(await state(user.clientId)), cascade });
    }
    const own = (await db.property.findMany({ where: { clientId: user.clientId, isActive: true }, select: { id: true } })).map((row) => row.id);
    const propertyIds = parsed.data.propertyIds?.length ? parsed.data.propertyIds : own;
    if (propertyIds.length === 0 || propertyIds.some((id) => !own.includes(id))) return NextResponse.json({ error: "Choose at least one of your properties." }, { status: 400 });
    await recordConsent({
      clientId: user.clientId,
      propertyIds,
      allowSuburb: Boolean(parsed.data.allowSuburb),
      allowBefore: Boolean(parsed.data.allowBefore),
      method: "PORTAL",
      givenByName: user.name || user.email || "Client",
      givenByUserId: user.id,
    }, { userId: user.id, via: "PORTAL" });
    return NextResponse.json(await state(user.clientId));
  } catch (error) {
    if (error instanceof ConsentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Your choice was not saved. Try again." }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
