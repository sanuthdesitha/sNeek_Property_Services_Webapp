import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createSavedBlock, listSavedBlocks } from "@/lib/forms/saved-blocks";
import { templateErrorResponse } from "@/lib/forms/template-errors";
import type { FormField } from "@/lib/forms/types";

/**
 * Saved question blocks of the form builder.
 *   GET  → { blocks }                       ADMIN, OPS_MANAGER (read)
 *   POST { name, fields } → { block }       ADMIN
 */
const createSchema = z.object({
  name: z.string().trim().min(1, "Give the block a name.").max(120),
  fields: z.array(z.record(z.unknown())).min(1).max(100),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json({ blocks: await listSavedBlocks() });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = createSchema.parse(await req.json());
    const block = await createSavedBlock({
      name: body.name,
      fields: body.fields as unknown as FormField[],
      actorId: session.user.id,
    });
    return NextResponse.json({ block }, { status: 201 });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
