import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createFormGroup, createGroupSchema, listFormGroups } from "@/lib/forms/template-groups";
import { templateErrorResponse } from "@/lib/forms/template-errors";

/** Forms-library groups. Reading matches the template list (ADMIN, OPS_MANAGER); writing is ADMIN, as for templates. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json({ groups: await listFormGroups() });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = createGroupSchema.parse(await req.json());
    return NextResponse.json({ group: await createFormGroup(body) }, { status: 201 });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
