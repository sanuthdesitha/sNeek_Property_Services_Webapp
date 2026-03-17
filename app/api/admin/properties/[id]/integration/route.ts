import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateIntegrationSchema } from "@/lib/validations/client";
import { syncPropertyIcal } from "@/lib/ical/sync";
import { serializeIntegrationNotes } from "@/lib/ical/options";
import { Role } from "@prisma/client";

/** PATCH – update iCal URL / enable toggle */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateIntegrationSchema.parse(await req.json());
    const existing = await db.integration.findUnique({
      where: { propertyId: params.id },
    });
    const notes = serializeIntegrationNotes({
      existingNotes: existing?.notes,
      noteText: body.notes,
      syncOptions: body.syncOptions,
    });

    const integration = await db.integration.upsert({
      where: { propertyId: params.id },
      create: {
        propertyId: params.id,
        icalUrl: body.icalUrl ?? null,
        isEnabled: body.isEnabled ?? false,
        notes,
      },
      update: {
        icalUrl: body.icalUrl ?? existing?.icalUrl ?? null,
        isEnabled: body.isEnabled ?? existing?.isEnabled ?? false,
        notes,
      },
    });

    return NextResponse.json(integration);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

/** POST – manual "Sync now" trigger */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const integration = await db.integration.findUnique({
      where: { propertyId: params.id },
    });
    if (!integration)
      return NextResponse.json({ error: "No integration found" }, { status: 404 });

    const result = await syncPropertyIcal(integration.id, {
      triggeredById: session.user.id,
      mode: "MANUAL",
    });

    return NextResponse.json({ message: "Sync completed", ...result });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
