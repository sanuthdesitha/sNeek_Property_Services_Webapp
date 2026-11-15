import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { AmenitiesLinkEmailError, emailAmenitiesLink } from "@/lib/checklists/amenities-link-email";
import { ExternalMessageError, idempotencyKeySchema } from "@/lib/notifications/external-recipient";

const bodySchema = z.object({ token: z.string().trim().min(1).max(128), idempotencyKey: idempotencyKeySchema });

/**
 * POST — email the property's amenities survey link (made just before by
 * POST ../amenities-link) to the client's billing email. Email only, through
 * the email design system (catalog `checklist.amenities_link`). ADMIN, or an
 * operations manager with the Properties pack at Manage (middleware); never
 * while testing as someone else. The answer says what the provider did
 * ("provider_accepted" is not delivered).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ error: "Links cannot be emailed while testing as someone else." }, { status: 403 });
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const result = await emailAmenitiesLink({ propertyId: params.id, token: body.token, actorId: session.user.id, idempotencyKey: body.idempotencyKey });
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof AmenitiesLinkEmailError || err instanceof ExternalMessageError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: "The request was not complete." }, { status: 400 });
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "The email could not be sent." : err.message }, { status });
  }
}
