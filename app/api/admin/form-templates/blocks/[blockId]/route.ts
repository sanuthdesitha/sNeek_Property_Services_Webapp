import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { deleteSavedBlock } from "@/lib/forms/saved-blocks";
import { templateErrorResponse } from "@/lib/forms/template-errors";

/** Delete a saved block (ADMIN). Forms that used it keep their copies. */
export async function DELETE(_req: NextRequest, { params }: { params: { blockId: string } }) {
  try {
    await requireRole([Role.ADMIN]);
    return NextResponse.json({ deleted: await deleteSavedBlock(params.blockId) });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
