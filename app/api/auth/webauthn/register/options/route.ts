import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  REGISTER_CHALLENGE_COOKIE,
  WEBAUTHN_RP_NAME,
  challengeCookieOptions,
  encodeChallengeCookie,
  getRelyingParty,
} from "@/lib/auth/webauthn";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const { rpID, origin } = getRelyingParty(req.headers);

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const existing = await db.webAuthnCredential.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: WEBAUTHN_RP_NAME,
      rpID,
      userID: user.id,
      userName: user.email ?? user.id,
      userDisplayName: user.name ?? user.email ?? "sNeek user",
      attestationType: "none",
      excludeCredentials: existing.map((cred) => ({
        id: Buffer.from(cred.credentialId, "base64url"),
        type: "public-key" as const,
        transports: parseTransports(cred.transports),
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
        // Platform authenticator => Face ID / Touch ID / fingerprint / Windows Hello.
        authenticatorAttachment: "platform",
      },
    });

    const res = NextResponse.json(options);
    res.cookies.set(
      REGISTER_CHALLENGE_COOKIE,
      encodeChallengeCookie(options.challenge),
      challengeCookieOptions(origin)
    );
    return res;
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: err?.message ?? "Could not start device registration." },
      { status }
    );
  }
}

function parseTransports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as AuthenticatorTransportFuture[];
  } catch {
    // stored as comma-separated fallback
    return value.split(",").map((t) => t.trim()).filter(Boolean) as AuthenticatorTransportFuture[];
  }
  return undefined;
}
