import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";
import { db } from "@/lib/db";
import {
  AUTHENTICATE_CHALLENGE_COOKIE,
  challengeCookieOptions,
  encodeChallengeCookie,
  getRelyingParty,
} from "@/lib/auth/webauthn";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { rpID, origin } = getRelyingParty(req.headers);
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    // If an email is supplied, scope allowCredentials to that user's devices.
    // Otherwise allow a usernameless / discoverable-credential ceremony.
    let allowCredentials:
      | { id: Buffer; type: "public-key"; transports?: AuthenticatorTransportFuture[] }[]
      | undefined;

    if (email) {
      const user = await db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (user) {
        const creds = await db.webAuthnCredential.findMany({
          where: { userId: user.id },
          select: { credentialId: true, transports: true },
        });
        allowCredentials = creds.map((c) => ({
          id: Buffer.from(c.credentialId, "base64url"),
          type: "public-key" as const,
          transports: parseTransports(c.transports),
        }));
      }
      // If no user / no creds, we still return options (don't leak account existence);
      // the verify step will fail cleanly.
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials,
    });

    const res = NextResponse.json(options);
    res.cookies.set(
      AUTHENTICATE_CHALLENGE_COOKIE,
      encodeChallengeCookie(options.challenge),
      challengeCookieOptions(origin)
    );
    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not start biometric sign in." },
      { status: 400 }
    );
  }
}

function parseTransports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as AuthenticatorTransportFuture[];
  } catch {
    return value.split(",").map((t) => t.trim()).filter(Boolean) as AuthenticatorTransportFuture[];
  }
  return undefined;
}
