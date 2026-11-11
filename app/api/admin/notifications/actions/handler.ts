import "server-only";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { OfficeActionError } from "@/lib/notifications/office-actions";
import { GuestMessageError } from "@/lib/notifications/guest-message";

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
    if (error instanceof OfficeActionError || error instanceof GuestMessageError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Check the message, recipients and transport." }, { status: 400, headers });
    return NextResponse.json({ error: "The message could not be sent." }, { status: getApiErrorStatus(error, 500), headers });
  }
}
