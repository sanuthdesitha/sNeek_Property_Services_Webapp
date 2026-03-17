import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Prisma, Role, JobType } from "@prisma/client";

const createTemplateSchema = z.object({
  name: z.string().min(1),
  serviceType: z.nativeEnum(JobType),
  schema: z.record(z.unknown()),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const templates = await db.formTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(templates);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = createTemplateSchema.parse(await req.json());
    const template = await db.formTemplate.create({
      data: { ...body, schema: body.schema as Prisma.InputJsonValue },
    });
    return NextResponse.json(template, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
