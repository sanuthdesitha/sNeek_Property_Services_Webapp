import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { getApiErrorStatus } from "@/lib/api/http";
import {
  getPropertyFormConfigWithRevision,
  PropertyFormConflictError,
  savePropertyFormConfigWithRevision,
} from "@/lib/property-form/config-store";

// Editor for the property intake form field-config. GET returns the saved
// config; PUT persists a sanitised config (sanitisation drops unknown system
// fields, forces locked core fields to stay required/visible, and clamps
// custom-field shapes). Definitions only — values live on Property.customFields.
//
// ADMIN and OPS_MANAGER, as before (operations managers need the Property
// form settings pack: View reads, Manage saves; lib/rbac/ops-catalog.ts).
// The response keeps the config's own fields at the top level for older
// callers and adds `revision`; a PUT with `expectedRevision` that is stale
// answers 409 with the current config and revision.

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { config, revision } = await getPropertyFormConfigWithRevision();
    return NextResponse.json({ ...config, revision });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const expected = body && typeof body === "object" && "expectedRevision" in body ? (typeof body.expectedRevision === "string" ? body.expectedRevision : null) : undefined;
    const { config, revision } = await savePropertyFormConfigWithRevision(body?.config ?? body, expected);
    return NextResponse.json({ ...config, revision });
  } catch (err: any) {
    if (err instanceof PropertyFormConflictError) {
      return NextResponse.json({ error: err.message, current: { ...err.current.config, revision: err.current.revision } }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
