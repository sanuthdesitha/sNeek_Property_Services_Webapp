import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { markAsPublished, publishSocialPost } from "@/lib/marketing/social-publish";

const patchSchema = z.object({
  action: z.enum(["publish-stub", "mark-published", "cancel"]).optional(),
  caption: z.string().min(1).max(10000).optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  externalUrl: z.string().url().optional(),
  externalId: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid", details: parsed.error.format() }, { status: 400 });
  }

  const { action, caption, scheduledFor, externalUrl, externalId } = parsed.data;

  if (action === "publish-stub") {
    const result = await publishSocialPost(params.id);
    return NextResponse.json(result);
  }

  if (action === "mark-published") {
    if (!externalUrl) {
      return NextResponse.json({ error: "externalUrl required" }, { status: 400 });
    }
    await markAsPublished(params.id, externalUrl, externalId);
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    await (db as any).socialPost.update({ where: { id: params.id }, data: { status: "CANCELLED" } });
    return NextResponse.json({ ok: true });
  }

  // Generic update
  await (db as any).socialPost.update({
    where: { id: params.id },
    data: {
      ...(caption !== undefined ? { caption } : {}),
      ...(scheduledFor !== undefined
        ? { scheduledFor: scheduledFor ? new Date(scheduledFor) : null }
        : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  await (db as any).socialPost.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
