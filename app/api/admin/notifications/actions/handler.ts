import "server-only";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { OfficeActionError } from "@/lib/notifications/office-actions";
import { ExternalMessageError } from "@/lib/notifications/external-recipient";
import { OfficeSendDenied, requireOfficeSend, type OfficeActor } from "@/lib/notifications/office-send-permission";
import type { OfficeSendAction } from "@/lib/notifications/office-send-rules";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Shared POST handler for the office message actions: live role check,
 * refused while impersonating (the message must come from the real person),
 * then the server function with the actual signed-in user as the actor.
 */
export async function handleOfficeAction<T>(request: Request, roles: Role[], run: (actorId: string, input: unknown) => Promise<T>) {
  try {
    const session = await requireRole(roles);
    if (session.impersonation) return NextResponse.json({ error: "Messages cannot be sent while impersonating." }, { status: 403, headers });
    const result = await run(session.user.id, await request.json());
    return NextResponse.json(result, { headers });
  } catch (error) {
    return officeActionError(error);
  }
}

/**
 * The same, for the sends gated by the page's ops pack
 * (`office-send-rules.ts`): ADMIN, or OPS_MANAGER holding that pack at
 * manage; never while impersonating. The actor (real person and the role that
 * allowed it) is passed on for the audit row.
 */
export async function handleGatedOfficeAction<T>(request: Request, action: OfficeSendAction, run: (actor: OfficeActor, input: unknown) => Promise<T>) {
  try {
    const { actor } = await requireOfficeSend(action);
    const result = await run(actor, await request.json());
    return NextResponse.json(result, { headers });
  } catch (error) {
    return officeActionError(error);
  }
}

function officeActionError(error: unknown): NextResponse {
  if (error instanceof OfficeSendDenied) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof OfficeActionError || error instanceof ExternalMessageError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Check the message, recipients and transport." }, { status: 400, headers });
  return NextResponse.json({ error: "The message could not be sent." }, { status: getApiErrorStatus(error, 500), headers });
}
