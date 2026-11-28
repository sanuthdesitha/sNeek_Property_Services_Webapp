/**
 * Settings › Cleaners & quality › Property reminder rules (smart property
 * reminders, slice B, 2026-11-28).
 *
 * GET   every rule: what it does, on or off, who changed it and when, and the
 *       live preview ("would currently create N reminders at M properties").
 *       ADMIN, and OPS_MANAGER with the Settings pack (view only).
 * PATCH { rule, enabled, seen? } — ADMIN only (OPS_MANAGER is refused), never
 *       while testing as someone; switching on needs the preview the person
 *       saw and is refused (409, with the new preview) when it changed.
 *       Audited with the actual actor.
 *
 * Live session and role on every call (requireRole → enforceOpsRequest).
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { loadPilotState } from "@/lib/pilots/state";
import { REMINDER_RULES, REMINDER_RULE_KEYS, describePreview, type RulePreview } from "@/lib/properties/reminders/rules";
import { RuleChangeError, loadRuleState, previewRule, saveRule } from "@/lib/properties/reminders/rules-load";

const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, code: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, code, ...extra }, { status, headers: privateHeaders });
}

function failure(error: unknown) {
  if (error instanceof RuleChangeError) return refuse(error.status, error.message, error.code, error.preview ? { preview: { ...error.preview, summary: describePreview(error.preview) } } : {});
  if (error instanceof ZodError || error instanceof SyntaxError) return refuse(400, "Choose a rule and whether it is on.", "INVALID_INPUT");
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
  if (message === "FORBIDDEN") return refuse(403, "You cannot see reminder rules.", "FORBIDDEN");
  console.error("[reminder-rules]", error);
  return refuse(500, "Could not load or save the reminder rules. Nothing was changed.", "FAILED");
}

const patchInput = z.object({
  rule: z.enum(REMINDER_RULE_KEYS),
  enabled: z.boolean(),
  seen: z.object({ reminders: z.number().int().min(0), properties: z.number().int().min(0), cleaners: z.number().int().min(0) }).nullable().optional(),
});

type PreviewView = (RulePreview & { summary: string }) | { failed: true };

async function previewSafe(rule: (typeof REMINDER_RULE_KEYS)[number]): Promise<PreviewView> {
  try {
    const preview = await previewRule(rule);
    return { ...preview, summary: describePreview(preview) };
  } catch (error) {
    console.error("[reminder-rules] preview failed", rule, error);
    return { failed: true };
  }
}

async function payload(canEdit: boolean) {
  const [state, pilots] = await Promise.all([loadRuleState(), loadPilotState()]);
  const changedBy = Array.from(new Set(REMINDER_RULE_KEYS.map((key) => state.rules[key].changedById).filter((id): id is string => Boolean(id))));
  const users = changedBy.length ? await db.user.findMany({ where: { id: { in: changedBy } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name || user.email || user.id] as const));
  const previews = await Promise.all(REMINDER_RULE_KEYS.map((key) => previewSafe(key)));
  return {
    readable: state.readable,
    canEdit,
    pilot: !pilots.readable ? "UNREADABLE" : pilots.pilots["property-reminders"].mode,
    rules: REMINDER_RULES.map((rule, index) => {
      const setting = state.rules[rule.key];
      return { ...rule, enabled: setting.enabled, changedAt: setting.changedAt, changedBy: setting.changedById ? names.get(setting.changedById) ?? "Unknown person" : null, preview: previews[index] };
    }),
  };
}

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await payload(session.user.role === Role.ADMIN && !session.impersonation), { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) return refuse(403, "Stop testing as another person before you change a rule.", "IMPERSONATION_NOT_ALLOWED");
    const input = patchInput.parse(await req.json());
    const saved = await saveRule({ id: session.user.id, role: Role.ADMIN }, input);
    return NextResponse.json({ rule: input.rule, ...saved }, { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}
