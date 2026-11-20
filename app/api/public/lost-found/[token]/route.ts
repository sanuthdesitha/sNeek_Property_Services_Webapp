import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getClientIp } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { GUEST_LINK_REFUSALS, GuestLinkError, guestLinkRateLimited, guestSubmitRateLimited, resolveGuestLink } from "@/lib/lost-found/guest-link";
import { guestPageView, ReturnRequestError, submitGuestRequest, withdrawGuestRequest } from "@/lib/lost-found/return-requests";

/**
 * The guest's no-login page for one lost item (2026-11-20). The item is found
 * from the token alone; nothing in the URL or body can point it at another
 * item. A refused link answers with one sentence and no item data. Rate
 * limited per link and address; submissions have their own hourly limit.
 *
 * GET  → the page (item name, photos via the token, where and when found,
 *        property name and suburb, holding date, office phone, upcoming cleans
 *        as pickup dates, configured fees, the guest's own latest request).
 * POST { action: "submit", … } → a new or changed request (idempotent by
 *        `submissionKey`); { action: "withdraw", requestId, version }.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

function refusalResponse(state: keyof typeof GUEST_LINK_REFUSALS) {
  return NextResponse.json({ error: GUEST_LINK_REFUSALS[state], state }, { status: state === "invalid" ? 404 : 410, headers: NO_STORE });
}

async function open(req: NextRequest, token: string) {
  if (guestLinkRateLimited(token, getClientIp(req))) {
    return { refusal: NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429, headers: NO_STORE }) };
  }
  const resolved = await resolveGuestLink(token);
  if (resolved.state !== "open") return { refusal: refusalResponse(resolved.state) };
  return { resolved };
}

function failure(error: unknown, what: string) {
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the form and try again." }, { status: 400, headers: NO_STORE });
  if (error instanceof ReturnRequestError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
  if (error instanceof GuestLinkError) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Check the form and try again." }, { status: 400, headers: NO_STORE });
  logger.error({ err: error }, `lost and found guest page: ${what} failed`);
  return NextResponse.json({ error: "Something went wrong. Please try again, or contact the office." }, { status: 500, headers: NO_STORE });
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { refusal, resolved } = await open(req, params.token);
    if (refusal) return refusal;
    return NextResponse.json(await guestPageView(resolved!), { headers: NO_STORE });
  } catch (error) {
    return failure(error, "read");
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { refusal, resolved } = await open(req, params.token);
    if (refusal) return refusal;
    if (guestSubmitRateLimited(params.token)) return NextResponse.json({ error: "Too many changes in the last hour. Please wait, or contact the office." }, { status: 429, headers: NO_STORE });
    const body = (await req.json()) as { action?: unknown } | null;
    if (body?.action === "withdraw") return NextResponse.json({ request: await withdrawGuestRequest(resolved!, body) }, { headers: NO_STORE });
    const result = await submitGuestRequest(resolved!, body);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: NO_STORE });
  } catch (error) {
    return failure(error, "submit");
  }
}
