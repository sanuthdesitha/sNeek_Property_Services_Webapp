import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getAuthUserState } from "@/lib/auth/account-state";
import { db } from "@/lib/db";
import { findTour } from "@/lib/tutorials/registry";
import { readTourClientState, recordTourProgress } from "@/lib/tutorials/store";
import { progressInputSchema } from "@/lib/tutorials/validation";
import { isSameOrigin, tourFailure, tourJson } from "@/lib/tutorials/http";
import type { TourRole } from "@/lib/tutorials/types";

export const dynamic = "force-dynamic";

/**
 * The signed-in person's own tutorial state. While testing as someone else
 * (session.impersonation) nothing is read or recorded for either person: the
 * response says so and the browser never starts a tour on its own.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const impersonating = Boolean(session.impersonation);
    const legacyWelcomeSeen = impersonating ? true : (await getAuthUserState(session.user.id))?.tutorialSeen === true;
    const state = await readTourClientState(db, {
      userId: session.user.id,
      role: session.user.role as TourRole,
      impersonating,
      legacyWelcomeSeen,
    });
    return tourJson(state);
  } catch (error) {
    return tourFailure(error);
  }
}

/** Record progress on one tour, for the person signed in only. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return tourJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireSession();
    if (session.impersonation) {
      return tourJson({ error: "Testing as someone else: tour progress is not recorded.", recorded: false }, 409);
    }
    const input = progressInputSchema.parse(await req.json().catch(() => ({})));
    const tour = findTour(input.tourKey);
    const held = (session.user.heldRoles ?? [session.user.role]) as TourRole[];
    if (!tour || !tour.roles.some((role) => held.includes(role))) {
      return tourJson({ error: "This tour is not for your account." }, 403);
    }
    const record = await recordTourProgress(db, session.user.id, input);
    return tourJson({ recorded: true, progress: record });
  } catch (error) {
    return tourFailure(error);
  }
}
