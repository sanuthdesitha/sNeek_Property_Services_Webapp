import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateTourPreference } from "@/lib/tutorials/store";
import { preferenceInputSchema } from "@/lib/tutorials/validation";
import { isSameOrigin, tourFailure, tourJson } from "@/lib/tutorials/http";

export const dynamic = "force-dynamic";

/** The person's own "Show tours" switch and "Don't show again" choices. */
export async function PATCH(req: NextRequest) {
  if (!isSameOrigin(req)) return tourJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireSession();
    if (session.impersonation) {
      return tourJson({ error: "Testing as someone else: tour choices are not recorded.", recorded: false }, 409);
    }
    const patch = preferenceInputSchema.parse(await req.json().catch(() => ({})));
    const preference = await updateTourPreference(db, session.user.id, patch, session.user.id);
    return tourJson({ recorded: true, preference });
  } catch (error) {
    return tourFailure(error);
  }
}
