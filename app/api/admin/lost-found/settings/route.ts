import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { readLostFoundSettings, saveLostFoundSettings } from "@/lib/lost-found/settings";

function failure(err: unknown) {
  if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid settings." }, { status: 400 });
  const message = err instanceof Error ? err.message : "Could not save.";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

/** GET — the holding period (office roles can read it; it drives their list). */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await readLostFoundSettings());
  } catch (err) {
    return failure(err);
  }
}

/** PUT — administrators change the holding period (audited). */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    return NextResponse.json(await saveLostFoundSettings(session.user, await req.json()));
  } catch (err) {
    return failure(err);
  }
}
