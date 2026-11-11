import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { deleteFormGroup, updateFormGroup, updateGroupSchema } from "@/lib/forms/template-groups";
import { templateErrorResponse } from "@/lib/forms/template-errors";

type Params = { params: { groupId: string } };

/** Rename / reorder a group (ADMIN). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireRole([Role.ADMIN]);
    const body = updateGroupSchema.parse(await req.json());
    return NextResponse.json({ group: await updateFormGroup(params.groupId, body) });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}

/** Delete a group (ADMIN). Its forms become ungrouped; none is changed otherwise. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole([Role.ADMIN]);
    return NextResponse.json(await deleteFormGroup(params.groupId));
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
