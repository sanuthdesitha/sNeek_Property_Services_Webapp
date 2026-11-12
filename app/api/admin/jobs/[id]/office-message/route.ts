import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getApiErrorStatus } from "@/lib/api/http";
import { OfficeActionError } from "@/lib/notifications/office-actions";
import { OfficeSendDenied, requireOfficeSend } from "@/lib/notifications/office-send-permission";
import { previewJobOfficeMessage, sendJobOfficeMessage } from "@/lib/notifications/job-office-message";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function failure(error: unknown, fallback: string) {
  if (error instanceof OfficeSendDenied) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof OfficeActionError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Check the message, recipients and how to send it." }, { status: 400, headers });
  return NextResponse.json({ error: fallback }, { status: getApiErrorStatus(error, 500), headers });
}

/**
 * "Message team" on a job (owner decision 2026-11-13; catalog
 * `job.office_message`). ADMIN, or OPS_MANAGER with the Jobs pack at manage
 * (the office-send rule, `job_team_message`); never while impersonating.
 *
 * GET: the cleaners assigned now, what each transport can do, the sender's
 * saved "Don't ask again" choice and the title the cleaner will see.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { session } = await requireOfficeSend("job_team_message");
    return NextResponse.json(await previewJobOfficeMessage(params.id, { id: session.user.id, impersonating: Boolean(session.impersonation) }), { headers });
  } catch (error) {
    return failure(error, "The team could not be loaded.");
  }
}

/** POST { recipientIds, body, transports, idempotencyKey, rememberTransports? } — see lib/notifications/job-office-message.ts. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { actor } = await requireOfficeSend("job_team_message");
    return NextResponse.json(await sendJobOfficeMessage(actor, params.id, await request.json()), { headers });
  } catch (error) {
    return failure(error, "The message could not be sent.");
  }
}
