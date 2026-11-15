import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { messageTemplateInput } from "@/lib/messages/template-admin";

/**
 * Message templates. ADMIN and OPS_MANAGER (operations managers need the
 * communications pack: View reads, Manage writes; lib/rbac/ops-catalog.ts).
 * The list stays a plain array for older callers.
 */
export async function GET(_req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const templates = await db.messageTemplate.findMany({
      orderBy: [{ triggerType: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(templates);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = messageTemplateInput.parse(await req.json());
    const template = await db.messageTemplate.create({
      data: { ...body, subject: body.channel === "SMS" ? null : body.subject ?? null, isActive: body.isActive ?? true },
    });
    return NextResponse.json(template, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
