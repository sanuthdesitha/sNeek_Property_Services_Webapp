import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { updateChatChannel } from "@/lib/workforce/service";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const channel = await updateChatChannel({
      channelId: params.id,
      name: body.name ? String(body.name) : null,
      description: body.description ? String(body.description) : null,
      memberUserIds: Array.isArray(body.memberUserIds) ? body.memberUserIds.map(String) : undefined,
    });
    return NextResponse.json(channel);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update channel." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
