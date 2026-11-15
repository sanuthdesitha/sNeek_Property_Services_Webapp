import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { saveTourSetting } from "@/lib/tutorials/store";
import { tourSettingInputSchema } from "@/lib/tutorials/validation";
import { isSameOrigin, tourFailure, tourJson } from "@/lib/tutorials/http";

export const dynamic = "force-dynamic";

/**
 * Publish an administrator's wording, order, status or What's new change to a
 * tour. Targets come from the registry only. Administrators only; an ordinary
 * confirmation on the screen, no PIN (tours neither send nor charge).
 */
export async function PATCH(req: NextRequest, { params }: { params: { key: string } }) {
  if (!isSameOrigin(req)) return tourJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireRole([Role.ADMIN]);
    const input = tourSettingInputSchema.parse(await req.json().catch(() => ({})));
    const setting = await saveTourSetting(db, decodeURIComponent(params.key), input, session.user.id);
    return tourJson({ setting });
  } catch (error) {
    return tourFailure(error);
  }
}
