import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError, z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { catalogView, changeExistingSwitch, existingSwitchSchema } from "@/lib/notifications/catalog-switches";
import { getNotificationTypeControls, saveNotificationTypeControls, typeControlsPatchSchema, TypeControlsConflictError } from "@/lib/notifications/type-controls";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * GET: every notification type with its switches resolved to the existing
 * settings. ADMIN and OPS_MANAGER, like the other notification read routes
 * (ops-pack gating: communications, by the shared middleware).
 * PATCH: ADMIN only, never while impersonating — either one existing switch
 * (`existingSwitch`) or the per-type controls (`controls`).
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const controls = await getNotificationTypeControls();
    return NextResponse.json({ types: await catalogView(controls), controlsUpdatedAt: controls.updatedAt }, { headers });
  } catch (error) {
    return NextResponse.json({ error: "Could not load notification types." }, { status: getApiErrorStatus(error, 503), headers });
  }
}

const patchSchema = z.union([
  z.object({ existingSwitch: existingSwitchSchema }).strict(),
  z.object({ controls: typeControlsPatchSchema }).strict(),
]);

export async function PATCH(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) return NextResponse.json({ error: "Notification switches cannot be changed while impersonating." }, { status: 403, headers });
    const body = patchSchema.parse(await request.json());
    if ("existingSwitch" in body) {
      await changeExistingSwitch(session.user.id, body.existingSwitch);
    } else {
      await saveNotificationTypeControls(session.user.id, body.controls);
    }
    const controls = await getNotificationTypeControls();
    return NextResponse.json({ types: await catalogView(controls), controlsUpdatedAt: controls.updatedAt }, { headers });
  } catch (error) {
    if (error instanceof TypeControlsConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid notification switch change." }, { status: 400, headers });
    return NextResponse.json({ error: "Could not save the notification switch." }, { status: getApiErrorStatus(error, 500), headers });
  }
}
