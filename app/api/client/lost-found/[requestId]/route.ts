/**
 * GET  /api/client/lost-found/[requestId] → { preview } — the approval message
 *      the guest would get (only useful when clients may approve).
 * POST /api/client/lost-found/[requestId] { verdict, version, note?, decisionKey? }
 *      — recommend / not recommend a waiting request; or, when Settings ›
 *      Lost and found lets clients approve, approve it as asked (account
 *      holder only).
 * Guard: the client-portal chokepoint with the properties permission; the
 * request must belong to an item at a property in the caller's scope (404
 * otherwise, the same as a request that does not exist).
 */
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { clientApprovalPreview, clientReviewReturnRequest } from "@/lib/lost-found/return-client";
import { ReturnRequestError } from "@/lib/lost-found/return-requests";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function failure(err: unknown) {
  if (err instanceof ReturnRequestError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers });
  if (err instanceof ZodError || err instanceof SyntaxError) return NextResponse.json({ error: "Check your answer and try again." }, { status: 400, headers });
  const message = err instanceof Error ? err.message : "";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: status === 500 ? "Your answer was not saved." : "You do not have access to this." }, { status, headers });
}

export async function GET(_req: NextRequest, { params }: { params: { requestId: string } }) {
  try {
    const portal = await requireClientPortal({ permission: "properties" });
    return NextResponse.json({ preview: await clientApprovalPreview(portal, params.requestId) }, { headers });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { requestId: string } }) {
  try {
    const portal = await requireClientPortal({ permission: "properties" });
    return NextResponse.json(await clientReviewReturnRequest(portal, params.requestId, await req.json()), { headers });
  } catch (err) {
    return failure(err);
  }
}
