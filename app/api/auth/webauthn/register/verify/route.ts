import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/types";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  REGISTER_CHALLENGE_COOKIE,
  decodeChallengeCookie,
  deviceNameFromUserAgent,
  getRelyingParty,
} from "@/lib/auth/webauthn";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const { rpID, origin } = getRelyingParty(req.headers);

    const expectedChallenge = decodeChallengeCookie(
      req.cookies.get(REGISTER_CHALLENGE_COOKIE)?.value
    );
    if (!expectedChallenge) {
      return NextResponse.json(
        { error: "Registration challenge expired. Please try again." },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => null)) as RegistrationResponseJSON | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid registration payload." }, { status: 400 });
    }

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      const res = NextResponse.json({ error: "Could not verify this device." }, { status: 400 });
      res.cookies.delete(REGISTER_CHALLENGE_COOKIE);
      return res;
    }

    const info = verification.registrationInfo;
    const credentialIdB64 = Buffer.from(info.credentialID).toString("base64url");
    const publicKeyB64 = Buffer.from(info.credentialPublicKey).toString("base64url");
    const transports = Array.isArray(body.response?.transports)
      ? JSON.stringify(body.response.transports)
      : null;
    const deviceName = deviceNameFromUserAgent(req.headers.get("user-agent"));

    // Idempotent: a device may re-enrol the same credential.
    const existing = await db.webAuthnCredential.findUnique({
      where: { credentialId: credentialIdB64 },
      select: { id: true, userId: true },
    });
    if (existing && existing.userId !== session.user.id) {
      const res = NextResponse.json(
        { error: "This device is already linked to another account." },
        { status: 409 }
      );
      res.cookies.delete(REGISTER_CHALLENGE_COOKIE);
      return res;
    }

    await db.webAuthnCredential.upsert({
      where: { credentialId: credentialIdB64 },
      create: {
        userId: session.user.id,
        credentialId: credentialIdB64,
        publicKey: publicKeyB64,
        counter: BigInt(info.counter),
        transports,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        deviceName,
        lastUsedAt: new Date(),
      },
      update: {
        publicKey: publicKeyB64,
        counter: BigInt(info.counter),
        transports,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        lastUsedAt: new Date(),
      },
    });

    const res = NextResponse.json({ verified: true, deviceName });
    res.cookies.delete(REGISTER_CHALLENGE_COOKIE);
    return res;
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    const res = NextResponse.json(
      { error: err?.message ?? "Could not register this device." },
      { status }
    );
    res.cookies.delete(REGISTER_CHALLENGE_COOKIE);
    return res;
  }
}
