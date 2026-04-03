import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listAccessibleChatChannels } from "@/lib/workforce/service";

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY]);
    const channels = await listAccessibleChatChannels(session.user.id);
    return NextResponse.json(channels);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load channels." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
