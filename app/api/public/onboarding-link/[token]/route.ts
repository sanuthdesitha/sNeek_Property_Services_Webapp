import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/security/rate-limit";
import {
  CLIENT_LINK_REFUSALS,
  clientLinkPageView,
  clientLinkRateLimited,
  finishClientLink,
  resolveClientLink,
  saveClientLinkSection,
} from "@/lib/onboarding/workspace/client-link";
import { onboardingRouteError } from "@/lib/onboarding/workspace/route-errors";

/**
 * The client's no-login onboarding page. The survey is found from the token
 * alone; nothing in the URL or body can point it at another onboarding. A
 * refused link answers with one sentence and nothing else.
 */
const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

async function open(req: NextRequest, token: string) {
  if (clientLinkRateLimited(token, getClientIp(req))) {
    return { refusal: NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429, headers: NO_STORE }) };
  }
  const resolved = await resolveClientLink(token);
  if (resolved.state !== "open") {
    return { refusal: NextResponse.json({ error: CLIENT_LINK_REFUSALS[resolved.state], state: resolved.state }, { status: resolved.state === "invalid" ? 404 : 410, headers: NO_STORE }) };
  }
  return { resolved };
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { refusal, resolved } = await open(req, params.token);
    if (refusal) return refusal;
    return NextResponse.json(await clientLinkPageView(resolved!), { headers: NO_STORE });
  } catch (error) {
    return onboardingRouteError(error, "client link read");
  }
}

/** Save one part. Answers are marked as coming from the client. */
export async function PATCH(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { refusal, resolved } = await open(req, params.token);
    if (refusal) return refusal;
    const saved = await saveClientLinkSection(resolved!, await req.json().catch(() => null));
    return NextResponse.json({ savedAt: saved.savedAt, revision: saved.revision }, { headers: NO_STORE });
  } catch (error) {
    return onboardingRouteError(error, "client link save");
  }
}

/** "I'm finished": tells the office in its inbox. Activates nothing. */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { refusal, resolved } = await open(req, params.token);
    if (refusal) return refusal;
    return NextResponse.json(await finishClientLink(resolved!), { headers: NO_STORE });
  } catch (error) {
    return onboardingRouteError(error, "client link finish");
  }
}
