import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { checkVisionConnection } from "@/lib/ai/vision";
export async function POST() {
  try {
    await requireRole([Role.ADMIN]);
    return NextResponse.json(await checkVisionConnection(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 502;
    return NextResponse.json({ error: status === 502 ? "Could not verify provider and model access. Check the server credential and saved model." : message }, { status });
  }
}
