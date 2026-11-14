import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { readTourSettings, readTourStats, setRoleToursOn } from "@/lib/tutorials/store";
import { roleSwitchSchema } from "@/lib/tutorials/validation";
import { isSameOrigin, tourFailure, tourJson } from "@/lib/tutorials/http";

export const dynamic = "force-dynamic";

/** Settings › System › Tutorials overview. Operations managers may view (Settings pack). */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [settings, stats] = await Promise.all([readTourSettings(db), readTourStats(db)]);
    return tourJson({ settings, stats, canEdit: session.user.role === Role.ADMIN });
  } catch (error) {
    return tourFailure(error);
  }
}

/** Tours on or off for a role. Administrators only. */
export async function PATCH(req: NextRequest) {
  if (!isSameOrigin(req)) return tourJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireRole([Role.ADMIN]);
    const input = roleSwitchSchema.parse(await req.json().catch(() => ({})));
    await setRoleToursOn(db, input.role, input.toursOn, session.user.id);
    return tourJson({ settings: await readTourSettings(db) });
  } catch (error) {
    return tourFailure(error);
  }
}
