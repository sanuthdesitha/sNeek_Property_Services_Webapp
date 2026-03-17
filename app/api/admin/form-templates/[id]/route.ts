import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role, JobType } from "@prisma/client";
import { z } from "zod";

const updateTemplateSchema = z.object({
  name: z.string().optional(),
  serviceType: z.nativeEnum(JobType).optional(),
  schema: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const template = await db.formTemplate.findUnique({ where: { id: params.id } });
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(template);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN]);
    const body = updateTemplateSchema.parse(await req.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const template = await db.formTemplate.update({ where: { id: params.id }, data: body as any });
    return NextResponse.json(template);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN]);
    const existing = await db.formTemplate.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const template = await db.formTemplate.update({
      where: { id: params.id },
      data: { isActive: false },
    });
    return NextResponse.json({ ok: true, template });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
