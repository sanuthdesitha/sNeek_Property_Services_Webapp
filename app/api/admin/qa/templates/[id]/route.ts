import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  isActive: z.boolean().optional(),
  templateSchema: z.any().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = patchSchema.parse(await req.json());
    const before = await db.qaFormTemplate.findUnique({ where: { id: params.id } });
    if (!before) return NextResponse.json({ error: "QA template not found." }, { status: 404 });
    const updated = await db.qaFormTemplate.update({
      where: { id: params.id },
      data: {
        name: body.name,
        isActive: body.isActive,
        schema: body.templateSchema === undefined ? undefined : (body.templateSchema as any),
      },
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "QA_TEMPLATE_UPDATE",
        entity: "QaFormTemplate",
        entityId: updated.id,
        before: before as any,
        after: updated as any,
      },
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
