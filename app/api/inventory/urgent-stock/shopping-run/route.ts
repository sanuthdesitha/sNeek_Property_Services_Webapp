import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { addUrgentNeedsToShoppingRun, listOpenShoppingRuns } from "@/lib/inventory/urgent-stock-shopping";
import { isSameOrigin, urgentFailure, urgentJson } from "@/lib/inventory/urgent-stock-http";

export const dynamic = "force-dynamic";

/** GET — open shopping runs the office can add urgent needs to. */
export async function GET() {
  try {
    const session = await requireSession();
    return urgentJson({ runs: await listOpenShoppingRuns(session.user) });
  } catch (error) {
    return urgentFailure(error, "Could not load shopping runs.");
  }
}

/**
 * POST — add needs to an open run or a new draft run (one answer per need).
 * Never marks a need ordered, bought or delivered.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return urgentJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireSession();
    return urgentJson(await addUrgentNeedsToShoppingRun(session.user, await req.json()));
  } catch (error) {
    return urgentFailure(error, "Could not add to the shopping run.");
  }
}
