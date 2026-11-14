import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createClientSchema } from "@/lib/validations/client";
import { Prisma, Role } from "@prisma/client";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { ClientCreateError, createClientWithLogin } from "@/lib/clients/create-client";
import { resolveAccountCreator } from "@/lib/accounts/account-creator";
import { clientLoginRefusal } from "@/lib/accounts/create-account-rules";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";

    const clients = await db.client.findMany({
      where: q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
        : {},
      include: { _count: { select: { properties: true } } },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(clients);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}

/**
 * POST /api/admin/clients — Add client. Administrators and operations managers
 * (Clients pack), as before. The portal login now uses the shared 7-day
 * invitation link (lib/accounts/create-account.ts) instead of an emailed
 * temporary password, and is refused while testing as someone else. Payment
 * terms and a Xero link keep their finance rule; the Xero contact is only read.
 * Repeat-safe with `idempotencyKey`. Never returns the link or a password.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createClientSchema.parse(await req.json());
    const portalLogin = body.sendPortalInvite === true;
    if (portalLogin) {
      const refusal = clientLoginRefusal(await resolveAccountCreator(session));
      if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
    }
    const result = await createClientWithLogin(
      {
        name: body.name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        suburb: body.suburb ?? null,
        state: body.state ?? null,
        postcode: body.postcode ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        placeId: body.placeId ?? null,
        notes: body.notes ?? null,
        paymentTermsDays: body.paymentTermsDays,
        xeroContactId: body.xeroContactId ?? null,
        portalLogin,
        notifications: body.notifications ?? null,
        portalVisibilityOverrides: body.portalVisibilityOverrides as Prisma.InputJsonValue | undefined,
      },
      { id: session.user.id, role: String(session.user.role), heldRoles: (session.user.heldRoles ?? [session.user.role]).map(String) },
      body.idempotencyKey ?? null,
    );
    const login = result.login;
    const emailOk = login ? login.email.state === "ACCEPTED" : true;
    return NextResponse.json(
      {
        ...result.client,
        invitedUserId: login?.user.id ?? null,
        invited: Boolean(login),
        replayed: result.replayed,
        login,
        xeroLinked: result.xeroLinked,
        warning: login && !emailOk ? `Client added, but the invitation could not be emailed${login.email.error ? `: ${login.email.error}` : ""}.` : undefined,
      },
      { status: result.replayed ? 200 : 201 }
    );
  } catch (err: any) {
    if (err instanceof ClientCreateError) return NextResponse.json({ error: err.message, field: err.field ?? null }, { status: err.status });
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not create client.") }, { status });
  }
}
