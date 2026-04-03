import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { updateChatMessage } from "@/lib/workforce/service";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; msgId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY]);
    const body = await req.json().catch(() => ({}));
    const result = await updateChatMessage({
      channelId: params.id,
      messageId: params.msgId,
      userId: session.user.id,
      body: body.body ? String(body.body) : null,
      delete: body.delete === true,
      pin: typeof body.pin === "boolean" ? body.pin : null,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update message." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
