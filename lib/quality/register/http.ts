import "server-only";
/**
 * The live gate every /api/admin/quality/register route runs: ADMIN or
 * OPS_MANAGER (requireRole also checks the quality pack for this path), the
 * pilot on for this person now, and the sources their packs include.
 */
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { isPilotOn } from "@/lib/pilots/state";
import { hubErrorResponse, readHubQuery } from "@/lib/quality/http";
import type { OpsLevels } from "@/lib/rbac/ops-catalog";
import { registerAllowedSources } from "./access";
import { RegisterLogError } from "./log-issue";
import { RegisterQueryError, parseRegisterFilters, type RegisterSource } from "./model";
import type { RegisterRequest } from "./service";

export class RegisterPilotOffError extends Error {}

export type RegisterViewer = {
  session: Awaited<ReturnType<typeof requireRole>>;
  levels: OpsLevels | null;
  allowed: Set<RegisterSource>;
};

export async function requireRegisterViewer(): Promise<RegisterViewer> {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  if (!(await isPilotOn("issues-register", { userId: session.user.id }))) throw new RegisterPilotOffError();
  const levels = await getOpsAccess(session.user);
  return { session, levels, allowed: registerAllowedSources(levels) };
}

export function readRegisterRequest(params: URLSearchParams, allowed: Set<RegisterSource>): RegisterRequest {
  // The period is the hub's (same parser); the filters are the register's.
  const { period } = readHubQuery(new URLSearchParams(Array.from(params.entries()).filter(([key]) => ["period", "from", "to"].includes(key))));
  return { period, filters: parseRegisterFilters(params, true), allowed };
}

export function registerErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof RegisterPilotOffError) {
    return NextResponse.json({ error: "The All issues register is not switched on for you.", code: "PILOT_OFF" }, { status: 409 });
  }
  if (error instanceof RegisterQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof RegisterLogError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json({ error: "Check the property, category, severity, description, date received and who raised it." }, { status: 400 });
  }
  return hubErrorResponse(error, fallback);
}
