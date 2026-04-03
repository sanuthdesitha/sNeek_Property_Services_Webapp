import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createChatMessage, listChatMessagesForUser } from "@/lib/workforce/service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY]);
    const after = new URL(req.url).searchParams.get("after");
    const messages = await listChatMessagesForUser(session.user.id, params.id, after);
    return NextResponse.json(messages);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load messages." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY]);
    const body = await req.json().catch(() => ({}));
    const message = await createChatMessage({
      channelId: params.id,
      senderId: session.user.id,
      body: String(body.body ?? ""),
      attachments: body.attachments && typeof body.attachments === "object" ? body.attachments as any : null,
    });
    return NextResponse.json(message, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not send message." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
