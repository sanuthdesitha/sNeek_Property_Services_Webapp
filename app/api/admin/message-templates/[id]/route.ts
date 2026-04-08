import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  triggerType: z.enum(["POST_JOB", "REVIEW_REQUEST", "DISCOUNT", "NEXT_CLEAN", "MANUAL"]).optional(),
  jobType: z.string().optional().nullable(),
  channel: z.enum(["EMAIL", "SMS"]).optional(),
  subject: z.string().max(500).optional().nullable(),
  body: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const template = await db.messageTemplate.findUnique({ where: { id: params.id } });
    if (!template) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(template);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json());
    const template = await db.messageTemplate.update({
      where: { id: params.id },
      data: body,
    });
    return NextResponse.json(template);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    // Unlink from automation rules first
    await db.clientAutomationRule.updateMany({
      where: { templateId: params.id },
      data: { templateId: null },
    });
    await db.messageTemplate.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
