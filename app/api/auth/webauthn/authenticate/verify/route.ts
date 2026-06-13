import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import {
  AUTHENTICATE_CHALLENGE_COOKIE,
  decodeChallengeCookie,
  getRelyingParty,
  verifyAssertionAndGetUser,
} from "@/lib/auth/webauthn";

export const dynamic = "force-dynamic";

/**
 * Public assertion verification endpoint.
 *
 * The browser login UI does NOT need this route — it calls
 * signIn("webauthn", ...) which re-verifies inside the NextAuth provider's
 * authorize(). This endpoint exists for programmatic / native-app clients that
 * want a standalone "is this assertion valid?" check. It is single-use: the
 * challenge cookie is cleared after the attempt, and the signature counter is
 * advanced on success.
 */
export async function POST(req: NextRequest) {
  try {
    const { rpID, origin } = getRelyingParty(req.headers);
    const expectedChallenge = decodeChallengeCookie(
      req.cookies.get(AUTHENTICATE_CHALLENGE_COOKIE)?.value
    );
    if (!expectedChallenge) {
      return NextResponse.json(
        { error: "Sign-in challenge expired. Please try again." },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => null)) as AuthenticationResponseJSON | null;
    if (!body || typeof body !== "object") {
      const res = NextResponse.json({ error: "Invalid assertion payload." }, { status: 400 });
      res.cookies.delete(AUTHENTICATE_CHALLENGE_COOKIE);
      return res;
    }

    const user = await verifyAssertionAndGetUser({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!user) {
      const res = NextResponse.json(
        { error: "Could not verify this passkey." },
        { status: 401 }
      );
      res.cookies.delete(AUTHENTICATE_CHALLENGE_COOKIE);
      return res;
    }

    const res = NextResponse.json({
      verified: true,
      user: { id: user.id, email: user.email, name: user.name },
    });
    res.cookies.delete(AUTHENTICATE_CHALLENGE_COOKIE);
    return res;
  } catch (err: any) {
    const res = NextResponse.json(
      { error: err?.message ?? "Could not verify this passkey." },
      { status: 400 }
    );
    res.cookies.delete(AUTHENTICATE_CHALLENGE_COOKIE);
    return res;
  }
}
