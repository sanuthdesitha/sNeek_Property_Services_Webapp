import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { OfficeActionError, sendClientDelayNotice } from "@/lib/notifications/office-actions";
import { previewClientDelayNotice } from "@/lib/notifications/client-delay-preview";
import { handleOfficeAction } from "../handler";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Client delay notice (catalog `client.delay_notice`). ADMIN only until the
 * owner decides whether operations managers may message clients this way.
 */
export async function POST(request: Request) {
  return handleOfficeAction(request, [Role.ADMIN], sendClientDelayNotice);
}

/**
 * The confirm preview: recipients, exact wording, switched-off transports,
 * the send's refusal if it would refuse, and today's earlier request. Same
 * role as the send; nothing is sent.
 */
export async function GET(request: Request) {
  try {
    await requireRole([Role.ADMIN]);
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId")?.trim() ?? "";
    if (!jobId || jobId.length > 200) return NextResponse.json({ error: "jobId is required." }, { status: 400, headers });
    const rawEta = url.searchParams.get("etaMinutes");
    const eta = rawEta === null || rawEta === "" ? null : Number(rawEta);
    if (eta !== null && !(Number.isInteger(eta) && eta >= 1 && eta <= 600)) return NextResponse.json({ error: "etaMinutes must be a whole number from 1 to 600." }, { status: 400, headers });
    return NextResponse.json(await previewClientDelayNotice(jobId, eta), { headers });
  } catch (error) {
    if (error instanceof OfficeActionError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: error instanceof Error && error.message === "FORBIDDEN" ? "FORBIDDEN" : "The preview could not be loaded." }, { status: getApiErrorStatus(error, 500), headers });
  }
}
