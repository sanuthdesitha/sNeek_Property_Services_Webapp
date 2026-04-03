import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createChatChannel } from "@/lib/workforce/service";

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const channel = await createChatChannel({
      name: String(body.name ?? ""),
      description: body.description ? String(body.description) : null,
      kind: body.kind ? String(body.kind) : null,
      groupId: body.groupId ? String(body.groupId) : null,
      memberUserIds: Array.isArray(body.memberUserIds) ? body.memberUserIds.map(String) : [],
      createdById: session.user.id,
    });
    return NextResponse.json(channel, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not create channel." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
