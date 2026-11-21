import "server-only";
/**
 * Shared request handling for the personal-switch routes (the person's own
 * route and the administrator's): body validation and error responses.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiErrorStatus } from "@/lib/api/http";
import { InvalidSwitchError, StaleSwitchesError, SwitchSubjectNotFoundError } from "./write";
import type { PersonalSwitchesView } from "./view-types";

export const SWITCH_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export const switchesSaveSchema = z.object({
  revision: z.number().int().min(0),
  changes: z.array(z.object({ id: z.string().min(1).max(200), on: z.boolean() }).strict()).min(1).max(200),
}).strict();

export type SwitchesSaveBody = z.infer<typeof switchesSaveSchema>;

export function readOnlyWhileTestingAs(): string {
  return "You are testing as someone else: these switches are read-only. Stop testing to change them.";
}

/** A stale save is refused with the current switches, so the screen can show them without losing the draft. */
export function switchesErrorResponse(error: unknown, current: PersonalSwitchesView | null, fallback: string): NextResponse {
  if (error instanceof StaleSwitchesError) return NextResponse.json({ error: error.message, code: "STALE", current }, { status: 409, headers: SWITCH_HEADERS });
  if (error instanceof SwitchSubjectNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: SWITCH_HEADERS });
  if (error instanceof InvalidSwitchError) return NextResponse.json({ error: error.message }, { status: 400, headers: SWITCH_HEADERS });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "That change could not be read." }, { status: 400, headers: SWITCH_HEADERS });
  const status = getApiErrorStatus(error, 500);
  return NextResponse.json({ error: status === 500 ? fallback : (error as Error).message }, { status, headers: SWITCH_HEADERS });
}
