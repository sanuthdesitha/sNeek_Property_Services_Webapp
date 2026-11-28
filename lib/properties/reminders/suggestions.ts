import "server-only";
/**
 * "Reminder suggestions" (smart property reminders, slice C, 2026-11-28).
 *
 * For every automatic rule that is switched OFF, the system proposes its
 * reminders as one-off suggestions with their facts. The office approves
 * (optionally after editing), or dismisses, singly or as a batch. Nothing
 * reaches a cleaner unapproved: an approval creates an office reminder
 * (origin SUGGESTION, the facts as its why). One row per rule and evidence,
 * so a dismissed suggestion is never proposed again for the same facts.
 * Cleaner-wide patterns ("same cleaner, same category") have no property, so
 * they are offered only as the automatic rule, not as suggestions.
 */
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { REMINDER_TEXT_MAX, NEXT_JOBS_MAX } from "./model";
import { REMINDER_RULES, REMINDER_RULE_KEYS, describePreview, enabledRules, previewOf, type ReminderRuleKey, type RulePreview, type RuleReminder } from "./rules";
import { evaluateRules, loadRuleState } from "./rules-load";
import { REMINDER_ROOM_LABEL, isReminderRoomKey } from "./sections";

export class SuggestionError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
  }
}

export type SuggestionActor = { id: string; role: Role };

/** Rules that can propose suggestions (one property each). */
const SUGGESTING_RULES: readonly ReminderRuleKey[] = REMINDER_RULE_KEYS.filter((key) => key !== "cleaner-repeat");

export type SuggestionView = {
  id: string;
  rule: ReminderRuleKey;
  ruleName: string;
  propertyId: string;
  propertyName: string;
  text: string;
  why: string;
  where: string;
  /** False when the facts no longer hold (it cannot be approved; it can be dismissed). */
  stillCurrent: boolean;
  createdAt: string;
};

export type SuggestionsPayload = {
  suggestions: SuggestionView[];
  /** Per rule that is off: what switching it on would do now (for "Always do this"). */
  previews: Array<RulePreview & { summary: string; name: string }>;
  canAlways: boolean;
  rulesReadable: boolean;
};

function whereLabel(moment: string, roomKey: string | null): string {
  if (moment === "ROOM") return isReminderRoomKey(roomKey) ? `In a room: ${REMINDER_ROOM_LABEL[roomKey]}` : "In a room";
  return moment === "BEFORE_LEAVING" ? "Before leaving" : "Before start";
}

async function currentProposals(now: Date): Promise<{ rules: ReminderRuleKey[]; reminders: RuleReminder[]; readable: boolean }> {
  const state = await loadRuleState();
  const on = new Set(enabledRules(state));
  // An unreadable switch value counts as all off, so every rule may propose.
  const rules = SUGGESTING_RULES.filter((key) => !on.has(key));
  return { rules, reminders: await evaluateRules(rules, null, now), readable: state.readable };
}

/** Record new proposals (existing rule + evidence pairs, whatever their status, are left alone). */
async function recordProposals(reminders: readonly RuleReminder[]): Promise<void> {
  const rows = reminders
    .filter((entry) => entry.propertyId)
    .map((entry) => ({
      rule: entry.rule,
      evidenceKey: entry.candidate.key,
      propertyId: entry.propertyId!,
      cleanerId: entry.candidate.cleanerId,
      text: entry.candidate.text,
      why: entry.candidate.why,
      moment: entry.candidate.moment,
      roomKey: entry.candidate.roomKey,
    }));
  if (rows.length > 0) await db.reminderSuggestion.createMany({ data: rows, skipDuplicates: true });
}

export async function listSuggestions(actor: SuggestionActor, now: Date = new Date()): Promise<SuggestionsPayload> {
  const proposals = await currentProposals(now);
  await recordProposals(proposals.reminders);
  const current = new Set(proposals.reminders.map((entry) => entry.candidate.key));
  const rows = await db.reminderSuggestion.findMany({
    where: { status: "PENDING", rule: { in: proposals.rules } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 300,
  });
  const properties = await db.property.findMany({ where: { id: { in: Array.from(new Set(rows.map((row) => row.propertyId))) } }, select: { id: true, name: true } });
  const propertyName = new Map(properties.map((property) => [property.id, property.name] as const));
  const ruleName = new Map(REMINDER_RULES.map((rule) => [rule.key, rule.name] as const));
  return {
    suggestions: rows.map((row) => ({
      id: row.id,
      rule: row.rule as ReminderRuleKey,
      ruleName: ruleName.get(row.rule as ReminderRuleKey) ?? row.rule,
      propertyId: row.propertyId,
      propertyName: propertyName.get(row.propertyId) ?? "Unknown property",
      text: row.text,
      why: row.why,
      where: whereLabel(row.moment, row.roomKey),
      stillCurrent: current.has(row.evidenceKey),
      createdAt: row.createdAt.toISOString(),
    })),
    previews: proposals.rules.map((rule) => {
      const preview = previewOf(rule, proposals.reminders);
      return { ...preview, summary: describePreview(preview), name: ruleName.get(rule) ?? rule };
    }),
    canAlways: actor.role === Role.ADMIN,
    rulesReadable: proposals.readable,
  };
}

export const decisionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss"), ids: z.array(z.string().min(1).max(64)).min(1).max(100) }),
  z.object({
    action: z.literal("approve"),
    ids: z.array(z.string().min(1).max(64)).min(1).max(100),
    /** Only with a single id: the office's edits before approving. */
    edit: z
      .object({
        text: z.string().trim().min(1).max(REMINDER_TEXT_MAX),
        jobsCount: z.number().int().min(1).max(NEXT_JOBS_MAX),
        mustConfirm: z.boolean(),
      })
      .optional(),
  }),
]);
export type DecisionInput = z.infer<typeof decisionInput>;

export type DecisionOutcome = "APPROVED" | "DISMISSED" | "ALREADY_DECIDED" | "FACTS_CHANGED" | "NOT_FOUND";

/**
 * Approve or dismiss suggestions. Each is decided once: a second decision
 * (another tab, another person) gets ALREADY_DECIDED and creates nothing.
 * Approving needs the facts to still hold; the reminder lasts the next job
 * unless the office said otherwise.
 */
export async function decideSuggestions(actor: SuggestionActor, raw: unknown, now: Date = new Date()): Promise<Array<{ id: string; outcome: DecisionOutcome; reminderId?: string }>> {
  const input = decisionInput.parse(raw);
  if (input.action === "approve" && input.edit && input.ids.length !== 1) throw new SuggestionError(400, "Edit one suggestion at a time.", "EDIT_ONE");
  const ids = Array.from(new Set(input.ids));
  const rows = await db.reminderSuggestion.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  let current: Set<string> | null = null;
  if (input.action === "approve") {
    const rules = Array.from(new Set(rows.map((row) => row.rule))).filter((rule): rule is ReminderRuleKey => (REMINDER_RULE_KEYS as readonly string[]).includes(rule));
    current = new Set((await evaluateRules(rules, null, now)).map((entry) => entry.candidate.key));
  }
  const results: Array<{ id: string; outcome: DecisionOutcome; reminderId?: string }> = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      results.push({ id, outcome: "NOT_FOUND" });
      continue;
    }
    if (row.status !== "PENDING") {
      results.push({ id, outcome: "ALREADY_DECIDED" });
      continue;
    }
    if (current && !current.has(row.evidenceKey)) {
      results.push({ id, outcome: "FACTS_CHANGED" });
      continue;
    }
    const result = await db.$transaction(async (tx) => {
      const claimed = await tx.reminderSuggestion.updateMany({
        where: { id, status: "PENDING" },
        data: { status: input.action === "approve" ? "APPROVED" : "DISMISSED", decidedById: actor.id, decidedRole: actor.role, decidedAt: now },
      });
      if (claimed.count !== 1) return { id, outcome: "ALREADY_DECIDED" as const };
      let reminderId: string | undefined;
      if (input.action === "approve") {
        const reminder = await tx.propertyReminder.create({
          data: {
            propertyId: row.propertyId,
            cleanerId: row.cleanerId,
            text: input.edit?.text ?? row.text,
            moment: row.moment,
            roomKey: row.roomKey,
            lifetime: "NEXT_JOBS",
            jobsCount: input.edit?.jobsCount ?? 1,
            mustConfirm: input.edit?.mustConfirm ?? false,
            reason: row.why,
            origin: "SUGGESTION",
            createdById: actor.id,
          },
        });
        reminderId = reminder.id;
        await tx.reminderSuggestion.update({ where: { id }, data: { reminderId } });
      }
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: input.action === "approve" ? "REMINDER_SUGGESTION_APPROVED" : "REMINDER_SUGGESTION_DISMISSED",
          entity: "ReminderSuggestion",
          entityId: id,
          before: { status: "PENDING", text: row.text, why: row.why } as Prisma.InputJsonValue,
          after: { actorRole: actor.role, reminderId: reminderId ?? null, edited: Boolean(input.action === "approve" && input.edit) } as Prisma.InputJsonValue,
        },
      });
      return { id, outcome: input.action === "approve" ? ("APPROVED" as const) : ("DISMISSED" as const), ...(reminderId ? { reminderId } : {}) };
    });
    results.push(result);
  }
  return results;
}
