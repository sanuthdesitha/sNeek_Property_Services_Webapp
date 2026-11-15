import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  MessageTemplateConflictError,
  MessageTemplateNotFoundError,
  messageTemplatePatch,
  updateMessageTemplate,
} from "@/lib/messages/template-admin";

function errorStatus(err: any, fallback: number): number {
  if (err instanceof MessageTemplateNotFoundError || err?.code === "P2025") return 404;
  return err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : fallback;
}

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
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: errorStatus(err, 500) });
  }
}

/** Save. With `expectedUpdatedAt` a template someone else saved since answers 409 with theirs. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = messageTemplatePatch.parse(await req.json());
    const template = await updateMessageTemplate(params.id, body);
    return NextResponse.json(template);
  } catch (err: any) {
    if (err instanceof MessageTemplateConflictError) {
      return NextResponse.json({ error: err.message, current: err.current }, { status: 409 });
    }
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: errorStatus(err, 400) });
  }
}

/** Delete (tier B in the editor). Automation rules lose the template (the relation sets it to null). */
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
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: errorStatus(err, 400) });
  }
}
