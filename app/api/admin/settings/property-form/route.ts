import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { getApiErrorStatus } from "@/lib/api/http";
import { getPropertyFormConfig, savePropertyFormConfig } from "@/lib/property-form/config";

// Admin editor for the property intake form field-config. GET returns the saved
// config; PUT persists a sanitised config (sanitisation drops unknown system
// fields, forces locked core fields to stay required/visible, and clamps
// custom-field shapes). Definitions only — values live on Property.customFields.

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const config = await getPropertyFormConfig();
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const config = await savePropertyFormConfig(body?.config ?? body);
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
