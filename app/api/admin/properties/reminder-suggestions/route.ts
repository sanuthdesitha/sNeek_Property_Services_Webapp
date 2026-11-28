/**
 * GET  /api/admin/properties/reminder-suggestions — the "Reminder
 *      suggestions" queue: one-off reminders proposed from the facts of rules
 *      that are switched off, with what each rule would do if switched on.
 * POST /api/admin/properties/reminder-suggestions — { action: "approve" |
 *      "dismiss", ids, edit? }: decide singly or as a batch.
 *
 * Smart property reminders, slice C (2026-11-28). ADMIN or OPS_MANAGER on the
 * live session; requireRole re-reads the operations policy, so an operations
 * manager needs the Properties pack (read to view, manage to decide).
 * Decisions are refused while testing as someone and audited with the actual
 * actor and role. "Always do this" (switching the rule on) is the ADMIN-only
 * rules route, after its preview. Works whatever the pilot state: approving
 * only creates an office reminder, which cleaners see while the pilot is on.
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { decideSuggestions, listSuggestions, SuggestionError } from "@/lib/properties/reminders/suggestions";

const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: privateHeaders });
}

function failure(error: unknown, fallback: string) {
  if (error instanceof SuggestionError) return refuse(error.status, error.message, error.code);
  if (error instanceof ZodError || error instanceof SyntaxError) return refuse(400, "Choose the suggestions and approve or dismiss. Edited text can be up to 280 characters.", "INVALID_INPUT");
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
  if (message === "FORBIDDEN") return refuse(403, "You cannot do this.", "FORBIDDEN");
  console.error("[reminder-suggestions]", error);
  return refuse(500, fallback, "FAILED");
}

function actorRole(role: Role): Role {
  return role === Role.ADMIN ? Role.ADMIN : Role.OPS_MANAGER;
}

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const payload = await listSuggestions({ id: session.user.id, role: actorRole(session.user.role) });
    return NextResponse.json({ ...payload, canAlways: payload.canAlways && !session.impersonation, canDecide: !session.impersonation }, { headers: privateHeaders });
  } catch (error) {
    return failure(error, "Could not load the suggestions.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return refuse(403, "Stop testing as another person before you decide suggestions.", "IMPERSONATION_NOT_ALLOWED");
    const results = await decideSuggestions({ id: session.user.id, role: actorRole(session.user.role) }, await req.json());
    return NextResponse.json({ results }, { headers: privateHeaders });
  } catch (error) {
    return failure(error, "Could not save every decision. Reload the list to see which were saved.");
  }
}
