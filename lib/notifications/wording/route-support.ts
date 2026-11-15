import "server-only";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { ZodError } from "zod";
import { getApiErrorStatus } from "@/lib/api/http";
import { wordingProviderAvailability } from "./ai-provider";
import { wordingEditDecision, WordingForbiddenError } from "./permission";
import { readTypeWording } from "./read";
import { WordingConflictError, WordingInvalidError, WordingMovedToDesignError, WordingNotFoundError } from "./store";
import { RegenerateUnavailableError } from "./regenerate";
import type { TypeWordingResponse } from "./view-types";
import type { WordingStatus } from "./types";

export const WORDING_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** The editor view of a type plus what the signed-in user may do with it. */
export async function typeWordingResponse(session: Session, typeKey: string): Promise<TypeWordingResponse | null> {
  const [view, decision, provider] = await Promise.all([readTypeWording(typeKey), wordingEditDecision(session), wordingProviderAvailability()]);
  if (!view) return null;
  return {
    typeKey,
    status: view.status as WordingStatus,
    reason: view.reason,
    href: view.href,
    parts: view.parts,
    canEdit: decision.allowed,
    editReason: decision.allowed ? null : decision.reason,
    regenerate: decision.allowed ? provider : { available: false, reason: decision.reason },
  };
}

/** One error mapping for the wording routes; never leaks internals. */
export function wordingErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof WordingForbiddenError) return NextResponse.json({ error: error.message }, { status: 403, headers: WORDING_HEADERS });
  if (error instanceof WordingConflictError) return NextResponse.json({ error: error.message, code: "stale" }, { status: 409, headers: WORDING_HEADERS });
  if (error instanceof RegenerateUnavailableError) return NextResponse.json({ error: error.message, code: "no_provider" }, { status: 409, headers: WORDING_HEADERS });
  if (error instanceof WordingInvalidError) return NextResponse.json({ error: error.message, problems: error.problems }, { status: 400, headers: WORDING_HEADERS });
  if (error instanceof WordingMovedToDesignError) return NextResponse.json({ error: error.message, code: "moved_to_design" }, { status: 409, headers: WORDING_HEADERS });
  if (error instanceof WordingNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: WORDING_HEADERS });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid wording request." }, { status: 400, headers: WORDING_HEADERS });
  return NextResponse.json({ error: fallback }, { status: getApiErrorStatus(error, 500), headers: WORDING_HEADERS });
}
