import { NextResponse } from "next/server";
import { getApiErrorStatus } from "@/lib/api/http";
import { OfficeActionError, sendClientDelayNotice } from "@/lib/notifications/office-actions";
import { previewClientDelayNotice } from "@/lib/notifications/client-delay-preview";
import { OfficeSendDenied, requireOfficeSend } from "@/lib/notifications/office-send-permission";
import { handleGatedOfficeAction } from "../handler";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Client delay notice (catalog `client.delay_notice`). ADMIN, or OPS_MANAGER
 * with the Jobs pack at manage (owner decision 2026-11-12); never while
 * impersonating. Audited with the actor's role.
 */
export async function POST(request: Request) {
  return handleGatedOfficeAction(request, "client_delay_notice", (actor, input) => sendClientDelayNotice(actor.id, input, actor.role));
}

/**
 * The confirm preview: recipients, exact wording, switched-off transports,
 * the send's refusal if it would refuse, and today's earlier request. Same
 * role as the send; nothing is sent.
 */
export async function GET(request: Request) {
  try {
    await requireOfficeSend("client_delay_notice");
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId")?.trim() ?? "";
    if (!jobId || jobId.length > 200) return NextResponse.json({ error: "jobId is required." }, { status: 400, headers });
    const rawEta = url.searchParams.get("etaMinutes");
    const eta = rawEta === null || rawEta === "" ? null : Number(rawEta);
    if (eta !== null && !(Number.isInteger(eta) && eta >= 1 && eta <= 600)) return NextResponse.json({ error: "etaMinutes must be a whole number from 1 to 600." }, { status: 400, headers });
    return NextResponse.json(await previewClientDelayNotice(jobId, eta), { headers });
  } catch (error) {
    if (error instanceof OfficeSendDenied) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof OfficeActionError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: error instanceof Error && error.message === "FORBIDDEN" ? "FORBIDDEN" : "The preview could not be loaded." }, { status: getApiErrorStatus(error, 500), headers });
  }
}
