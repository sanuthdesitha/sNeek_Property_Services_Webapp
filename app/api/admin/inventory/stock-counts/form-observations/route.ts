import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { FORM_COUNT_FILTERS, listFormCountObservations, markFormCountReviewed, type FormCountFilter } from "@/lib/inventory/stock-count-observation-list";
import { isSameOrigin, urgentFailure, urgentJson } from "@/lib/inventory/urgent-stock-http";

export const dynamic = "force-dynamic";

/** GET ?filter=review|pending|all — stock counts from job forms and what happened to each. */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const raw = req.nextUrl.searchParams.get("filter") ?? "review";
    const filter: FormCountFilter = (FORM_COUNT_FILTERS as readonly string[]).includes(raw) ? (raw as FormCountFilter) : "review";
    return urgentJson(await listFormCountObservations(filter));
  } catch (error) {
    return urgentFailure(error, "Could not load counts from job forms.");
  }
}

/** POST { id, note } — mark a count that could not be matched as reviewed. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return urgentJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return urgentJson(await markFormCountReviewed(session.user.id, await req.json()));
  } catch (error) {
    return urgentFailure(error, "Could not save.");
  }
}
