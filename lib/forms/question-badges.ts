/**
 * The badges on a question row in the builder. Every badge describes a
 * behaviour the stored schema really drives in the cleaner form or the submit
 * route; nothing is shown that the runtime does not do:
 *
 *  - Required; minimum / maximum files (upload types);
 *  - "Every Nth clean" (frequency ROTATIONAL, filtered per property);
 *  - "Shown if …" (an answer rule) or "If property …" (a property rule);
 *  - "'Yes' shows N" — other questions or sections whose rule watches this one;
 *  - "'No' asks for details" (detailsWhenNo);
 *  - device status, high priority, QA scored;
 *  - "Never answered in 90 days" only from the library's usage check
 *    (lib/forms/submission-stats.ts), passed in by the caller;
 *  - "Monthly" (frequency MONTHLY, first counted clean of each month);
 *  - effects: "Raises urgent stock below N", "'Yes' opens a damage report"
 *    (lib/forms/form-effects.ts — run by the submit route);
 *  - "Counts <item>" on a Stock count, "N columns" on a Table.
 *
 * PURE.
 */
import { getFieldTypeDef } from "./field-types";
import { isDeviceStatusField } from "./device-status";
import { describePropertyCondition } from "./property-conditions";
import { effectBadgeLabel, fieldEffects } from "./form-effects";
import { readTableConfig } from "./structured-answers";
import { isAnswerCondition, isPropertyFieldCondition, type FieldCondition, type FormField, type FormSchema } from "./types";

export type BadgeTone = "neutral" | "ok" | "warn" | "bad" | "info" | "gold";
export type QuestionBadge = { key: string; label: string; tone: BadgeTone };

export type BadgeContext = {
  /** id → label of every question, for "Shown if" wording. */
  labels: ReadonlyMap<string, string>;
  /** id → how many questions/sections watch it, per watched value. */
  watchers: ReadonlyMap<string, Watchers>;
  neverAnswered: ReadonlySet<string>;
};

export type Watchers = { total: number; whenYes: number; whenNo: number };

function valueOf(rule: FieldCondition): unknown {
  return "value" in rule ? rule.value : rule.equals;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

function describeValue(value: unknown): string {
  if (value === true || value === "true" || value === "yes") return "Yes";
  if (value === false || value === "false" || value === "no") return "No";
  if (Array.isArray(value)) return value.map(String).join(" or ");
  return String(value ?? "");
}

export function describeAnswerRule(rule: FieldCondition, labels: ReadonlyMap<string, string>): string {
  const watched = labels.get(rule.fieldId);
  const name = watched ? `"${watched}"` : "a removed question";
  const operator = rule.operator ?? "equals";
  const value = describeValue(valueOf(rule));
  switch (operator) {
    case "answered":
      return `Shown if ${name} is answered`;
    case "notAnswered":
      return `Shown if ${name} is not answered`;
    case "notEquals":
      return `Shown if ${name} is not ${value}`;
    case "contains":
    case "oneOf":
      return `Shown if ${name} includes ${value}`;
    case "notContains":
      return `Shown if ${name} excludes ${value}`;
    case "gt":
      return `Shown if ${name} is over ${value}`;
    case "lt":
      return `Shown if ${name} is under ${value}`;
    default:
      return `Shown if ${name} is ${value}`;
  }
}

export function buildBadgeContext(schema: FormSchema, neverAnswered: Iterable<string> = []): BadgeContext {
  const labels = new Map<string, string>();
  const watchers = new Map<string, Watchers>();
  const watch = (rule: unknown) => {
    if (!isAnswerCondition(rule as FieldCondition)) return;
    const answerRule = rule as FieldCondition;
    const entry = watchers.get(answerRule.fieldId) ?? { total: 0, whenYes: 0, whenNo: 0 };
    entry.total += 1;
    const value = valueOf(answerRule);
    if ((answerRule.operator ?? "equals") === "equals") {
      if (value === true || value === "yes") entry.whenYes += 1;
      if (value === false || value === "no") entry.whenNo += 1;
    }
    watchers.set(answerRule.fieldId, entry);
  };
  for (const section of schema.sections) {
    watch(section.conditional);
    for (const field of section.fields) {
      labels.set(field.id, field.label);
      watch(field.conditional);
      for (const child of field.children ?? []) {
        labels.set(child.id, child.label);
        watch(child.conditional);
      }
    }
  }
  return { labels, watchers, neverAnswered: new Set(neverAnswered) };
}

export function questionBadges(field: FormField, context: BadgeContext): QuestionBadge[] {
  const def = getFieldTypeDef(field.type);
  const badges: QuestionBadge[] = [];
  if (context.neverAnswered.has(field.id)) badges.push({ key: "never", label: "Never answered in 90 days", tone: "bad" });
  if (field.frequency === "ROTATIONAL") {
    badges.push({ key: "rotation", label: `Every ${ordinal(field.rotationEveryNCleans ?? 4)} clean`, tone: "gold" });
  }
  if (field.frequency === "MONTHLY") badges.push({ key: "rotation", label: "Monthly", tone: "gold" });
  if (field.type === "stock_count") {
    badges.push({ key: "stock-item", label: field.stockItemName ? `Counts ${field.stockItemName}` : "No item chosen", tone: field.stockItemId ? "neutral" : "bad" });
  }
  if (field.type === "table") {
    const table = readTableConfig(field.table);
    const rows = table.rowMode === "fixed" ? `${table.rowLabels?.length ?? 0} rows` : "cleaner adds rows";
    badges.push({ key: "table", label: `${table.columns.length} column${table.columns.length === 1 ? "" : "s"} · ${rows}`, tone: "neutral" });
  }
  for (const effect of fieldEffects(field)) {
    badges.push({ key: `effect-${effect.kind}`, label: effectBadgeLabel(effect), tone: effect.kind === "damage-report" ? "warn" : "neutral" });
  }
  if (isAnswerCondition(field.conditional)) {
    badges.push({ key: "rule", label: describeAnswerRule(field.conditional, context.labels), tone: "info" });
  } else if (isPropertyFieldCondition(field.conditional)) {
    badges.push({ key: "rule", label: describePropertyCondition(field.conditional), tone: "warn" });
  }
  const watched = context.watchers.get(field.id);
  if (watched && watched.total > 0) {
    const yesNo = field.type === "yesno" || field.type === "checkbox";
    const label =
      yesNo && watched.whenYes === watched.total
        ? `"Yes" shows ${watched.total}`
        : yesNo && watched.whenNo === watched.total
          ? `"No" shows ${watched.total}`
          : `Controls ${watched.total}`;
    badges.push({ key: "watchers", label, tone: "warn" });
  }
  if (field.type === "yesno" && field.detailsWhenNo) badges.push({ key: "details", label: "\"No\" asks for details", tone: "warn" });
  if (isDeviceStatusField(field)) badges.push({ key: "device", label: "Device status", tone: "neutral" });
  if (field.severity === "high") badges.push({ key: "severity", label: "High priority", tone: "bad" });
  if (def?.isUpload) {
    const min = Math.max(field.required ? 1 : 0, field.type === "video" ? 0 : field.minPhotos ?? 0);
    if (min > 0) badges.push({ key: "min", label: `Min ${min}`, tone: "neutral" });
    if (field.maxFiles) badges.push({ key: "max", label: `Max ${field.maxFiles}`, tone: "neutral" });
  }
  if (field.scoring) badges.push({ key: "scored", label: "Scored", tone: "neutral" });
  if (field.required && !def?.isReadOnly) badges.push({ key: "required", label: "Required", tone: "neutral" });
  return badges;
}

/** Short type label for the row ("Tick", "Yes / No", "Photo" …). */
export function questionTypeLabel(field: FormField): string {
  if (field.type === "checkbox") return "Tick";
  if (field.type === "instruction") return "Note";
  if (field.type === "barcode") return "Scan";
  return getFieldTypeDef(field.type)?.label ?? `Unknown (${field.type})`;
}
