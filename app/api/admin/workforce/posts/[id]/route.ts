import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateWorkforcePost } from "@/lib/workforce/service";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const post = await updateWorkforcePost({
      postId: params.id,
      title: String(body.title ?? ""),
      body: String(body.body ?? ""),
      type: body.type ? String(body.type) : "ANNOUNCEMENT",
      coverImageUrl: body.coverImageUrl ? String(body.coverImageUrl) : null,
      pinned: body.pinned === true,
      audience: body.audience && typeof body.audience === "object" ? body.audience as any : { all: true },
      attachments: body.attachments && typeof body.attachments === "object" ? body.attachments as any : null,
      publishAt: body.publishAt ? String(body.publishAt) : null,
    });
    return NextResponse.json(post);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update post." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await db.workforcePost.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not delete post." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
