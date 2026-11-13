import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getTransactionAppSettings } from "@/lib/settings";
import { earliestEffectiveFrom, ORIGINAL_EFFECTIVE_FROM, type RuleBook, type RuleVersionRecord } from "./book";
import { formatRuleValue, RULES, ruleSentence, SCHEDULING_WORKER_SCHEDULE } from "./registry";
import { PUBLISH_COOL_DOWN_MINUTES } from "./service";
import { settingsMatchLive } from "./store";
import { canonicalRuleValues, diffRuleValues, EDITABLE_RULE_KEYS, EDITABLE_RULE_SPECS, type EditableRuleKey } from "./values";
import type { RuleRowView, RuleSpecView, RuleVersionView, SchedulingRulesView } from "./view-types";

const KIND_LABEL: Record<RuleVersionRecord["kind"], string> = {
  ORIGINAL: "Original (current behaviour)",
  EDIT: "Edited",
  RESTORE: "Restored",
  IMPORT: "Restored from a backup",
};

function effectiveLabel(record: Pick<RuleVersionRecord, "effectiveFrom">): string {
  return record.effectiveFrom <= ORIGINAL_EFFECTIVE_FROM ? "From the start" : `From ${record.effectiveFrom}`;
}

export async function buildSchedulingRulesView(book: RuleBook, input: { canEdit: boolean; now?: Date }): Promise<SchedulingRulesView> {
  const now = input.now ?? new Date();
  const settings = await getTransactionAppSettings(db);
  const timezone = settings.timezone || "Australia/Sydney";
  const latest = book.versions[book.versions.length - 1];
  const actorIds = Array.from(new Set(book.versions.map((record) => record.createdById).filter((id): id is string => Boolean(id))));
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
  const actorName = new Map(actors.map((actor) => [actor.id, actor.name || actor.email]));
  const scheduledLast = book.scheduled[book.scheduled.length - 1] ?? null;

  const rules: RuleRowView[] = RULES.map((rule) => {
    const key = rule.editableKey ?? null;
    const valueText = key ? formatRuleValue(key, book.live.values[key]) : rule.fixedValue ?? "";
    const scheduledValueText = key && scheduledLast && scheduledLast.values[key] !== book.live.values[key] ? formatRuleValue(key, scheduledLast.values[key]) : null;
    return {
      id: rule.id,
      domain: rule.domain,
      section: rule.section,
      title: rule.title,
      kind: rule.kind,
      editableKey: key,
      valueText,
      sentence: ruleSentence(rule, book.live.values),
      appliesTo: rule.appliesTo,
      takesEffect: rule.takesEffect,
      origin: rule.origin,
      quirk: rule.quirk ?? null,
      scheduledValueText,
    };
  });

  const versions: RuleVersionView[] = book.versions.map((record, index) => {
    const previous = index > 0 ? book.versions[index - 1] : null;
    const status: RuleVersionView["status"] = record.version === book.live.version ? "LIVE" : book.scheduled.includes(record) ? "SCHEDULED" : "SUPERSEDED";
    return {
      version: record.version,
      kind: record.kind,
      label: KIND_LABEL[record.kind],
      effectiveFrom: record.effectiveFrom,
      effectiveLabel: effectiveLabel(record),
      appliesToExisting: record.appliesToExisting,
      reason: record.reason,
      restoredFromVersion: record.restoredFromVersion,
      createdAt: formatInTimeZone(record.createdAt, timezone, "d MMM yyyy, HH:mm"),
      createdBy: record.createdById ? actorName.get(record.createdById) ?? "Former account" : record.kind === "ORIGINAL" ? "System" : null,
      status,
      changeCount: previous ? diffRuleValues(previous.values, record.values).length : 0,
      values: canonicalRuleValues(record.values),
    };
  });

  const specs = Object.fromEntries(
    EDITABLE_RULE_KEYS.map((key) => {
      const spec = EDITABLE_RULE_SPECS[key] as { type: RuleSpecView["type"]; min?: number; max?: number; unit?: string };
      return [key, { type: spec.type, min: spec.min, max: spec.max, unit: spec.unit }];
    }),
  ) as Record<EditableRuleKey, RuleSpecView>;

  const lastPublished = [...book.versions].reverse().find((record) => record.kind !== "ORIGINAL");
  const coolDownEnd = lastPublished ? lastPublished.createdAt.getTime() + PUBLISH_COOL_DOWN_MINUTES * 60_000 : 0;

  return {
    liveVersion: book.live.version,
    latestVersion: latest.version,
    liveEffectiveLabel: effectiveLabel(book.live),
    rules,
    versions: versions.reverse(),
    specs,
    drift: settingsMatchLive(settings, book.live),
    workerSchedule: SCHEDULING_WORKER_SCHEDULE,
    canEdit: input.canEdit,
    earliestEffectiveFrom: earliestEffectiveFrom(now),
    coolDownUntil: coolDownEnd > now.getTime() ? new Date(coolDownEnd).toISOString() : null,
    timezone,
    readAt: now.toISOString(),
  };
}
