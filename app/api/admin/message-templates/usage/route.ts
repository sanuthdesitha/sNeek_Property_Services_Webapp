import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadTemplateUsage } from "@/lib/messages/template-admin";

/**
 * "Where it is used" for every message template: the client automation rules
 * and campaigns that point at it. Read only; same admission as the list
 * (operations managers need the communications pack at View).
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json({ usage: await loadTemplateUsage() });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message === "UNAUTHORIZED" || err.message === "FORBIDDEN" ? err.message : "Where it is used could not be read." }, { status });
  }
}
