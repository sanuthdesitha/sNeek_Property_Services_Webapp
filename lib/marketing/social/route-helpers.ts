import "server-only";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { socialRightRefusal, type SocialRight } from "./access";
import { ConsentError } from "./consent";
import { GroupError } from "./groups";
import { PublishRefused } from "./publish";
import { SocialAccountError } from "./accounts";
import { realHttpClient, type HttpClient } from "./networks/http";
import { stubHttpClient } from "./networks/stub";

/**
 * Shared guards and error answers for the social post generator routes
 * (2026-11-17). Every route calls the live session guard (requireRole) and,
 * for changes, the live right check; the Marketing pack is also enforced
 * for operations managers by the shared request guard on /api/admin/marketing.
 */

export async function requireSocialSession() {
  return requireRole([Role.ADMIN, Role.OPS_MANAGER]);
}

/** The session, refused (403 with the reason) when this person may not do it now. */
export async function requireSocialRight(right: SocialRight) {
  const session = await requireSocialSession();
  const refusal = await socialRightRefusal(session.user.id, right);
  if (refusal) throw new GroupError(403, refusal);
  return session;
}

export function socialErrorResponse(error: unknown): NextResponse {
  if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "You do not have access to this." }, { status: 403 });
  if (error instanceof PublishRefused) return NextResponse.json({ error: error.message, problems: error.problems }, { status: 409 });
  if (error instanceof GroupError) return NextResponse.json({ error: error.message, problems: error.details }, { status: error.status });
  if (error instanceof ConsentError || error instanceof SocialAccountError) return NextResponse.json({ error: error.message }, { status: error.status });
  logger.error({ err: error instanceof Error ? error.message : "unknown" }, "[social] request failed");
  return NextResponse.json({ error: "Something went wrong. Nothing was changed; try again." }, { status: 500 });
}

/**
 * The network layer for this process. Production always uses the real
 * official API. Outside production only, SNEEK_SOCIAL_NETWORK_STUB answers
 * like Meta without any network call (local inspection and tests).
 */
export function socialHttp(): { http: HttpClient; publicBase?: string; stubbed: boolean } {
  const stub = process.env.NODE_ENV !== "production" ? process.env.SNEEK_SOCIAL_NETWORK_STUB?.trim() : "";
  if (stub) return { http: stubHttpClient(stub), publicBase: "https://stub.invalid", stubbed: true };
  return { http: realHttpClient, stubbed: false };
}
