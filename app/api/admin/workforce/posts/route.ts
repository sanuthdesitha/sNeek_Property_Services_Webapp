import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createWorkforcePost, listAdminWorkforcePosts } from "@/lib/workforce/service";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const posts = await listAdminWorkforcePosts();
    return NextResponse.json(posts);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load posts." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const post = await createWorkforcePost({
      title: String(body.title ?? ""),
      body: String(body.body ?? ""),
      type: body.type ? String(body.type) : "ANNOUNCEMENT",
      coverImageUrl: body.coverImageUrl ? String(body.coverImageUrl) : null,
      pinned: body.pinned === true,
      audience: body.audience && typeof body.audience === "object" ? body.audience as any : { all: true },
      attachments: body.attachments && typeof body.attachments === "object" ? body.attachments as any : null,
      publishAt: body.publishAt ? String(body.publishAt) : null,
      createdById: session.user.id,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not create post." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
