/**
 * Question effects (lib/forms/types.ts, FieldEffect): what they say in the
 * builder and in "Test as cleaner", and what a submitted form asks the
 * existing services to do.
 *
 *  - "urgent-stock-below" on a Stock count: a count BELOW the threshold raises
 *    an urgent stock need through lib/inventory/urgent-stock.ts (the same
 *    report a cleaner makes from the stock screen), once per submission and
 *    item, as a durable follow-up of the submission. It never orders anything.
 *  - "damage-report" on a Yes / No: the chosen answer prompts the cleaner into
 *    the job's damage report (prefilled area / category). When the cleaner
 *    submits the form without having submitted that report, the submit route
 *    opens the one private damage case it already opens for reported damage.
 *
 * Only visible questions count (a hidden question's stale answer does nothing).
 *
 * PURE: no database.
 */
import { flattenFieldsOneLevel, isFlattenedFieldVisible, isTemplateNodeVisible } from "./visibility";
import { readStockCountAnswer } from "./structured-answers";
import type { DamageReportEffect, FieldEffect, UrgentStockEffect } from "./types";

type Node = Record<string, unknown>;

export type StockCountObservation = {
  fieldId: string;
  label: string;
  itemId: string;
  itemName: string | null;
  unit: string | null;
  count: number;
};

export type UrgentStockRequest = StockCountObservation & { threshold: number };

export type DamagePrompt = {
  fieldId: string;
  label: string;
  when: "yes" | "no";
  area: string;
  category: string;
};

export type SubmissionEffectsPlan = {
  /** Every valid stock count answer on the visible form (one per item). */
  stockCounts: StockCountObservation[];
  /** Counts below their question's threshold: an urgent need to raise. */
  urgentStock: UrgentStockRequest[];
  /** Yes / No answers that call for a damage report. */
  damage: DamagePrompt[];
};

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function fieldEffects(field: { effects?: unknown }): FieldEffect[] {
  return Array.isArray(field.effects) ? (field.effects.filter(isNode) as unknown as FieldEffect[]) : [];
}

export function urgentStockEffectOf(field: { type?: unknown; effects?: unknown }): UrgentStockEffect | null {
  if (field.type !== "stock_count") return null;
  const effect = fieldEffects(field).find((entry) => entry.kind === "urgent-stock-below") as UrgentStockEffect | undefined;
  return effect && Number.isInteger(effect.threshold) && effect.threshold >= 1 ? effect : null;
}

export function damageEffectOf(field: { type?: unknown; effects?: unknown }): DamageReportEffect | null {
  if (field.type !== "yesno") return null;
  const effect = fieldEffects(field).find((entry) => entry.kind === "damage-report") as DamageReportEffect | undefined;
  return effect && (effect.when === "yes" || effect.when === "no") ? effect : null;
}

/** True when a stored yes/no answer is the one the effect watches. */
export function yesNoMatches(value: unknown, when: "yes" | "no"): boolean {
  if (when === "yes") return value === true || value === "yes" || value === "Yes" || value === "true";
  return value === false || value === "no" || value === "No" || value === "false";
}

/** Badge text on the builder row, as drawn. */
export function effectBadgeLabel(effect: FieldEffect): string {
  if (effect.kind === "urgent-stock-below") return `Raises urgent stock below ${effect.threshold}`;
  return `"${effect.when === "yes" ? "Yes" : "No"}" opens a damage report`;
}

/** Exactly what the effect does, for the properties panel. */
export function effectExplanation(effect: FieldEffect): string {
  if (effect.kind === "urgent-stock-below") {
    return `When the cleaner submits a count below ${effect.threshold}, an urgent stock need is raised for this item at the property, reported by that cleaner, once per submission. It does not order or buy anything: the office decides what happens next on the Urgent stock page.`;
  }
  return `When the cleaner answers "${effect.when === "yes" ? "Yes" : "No"}", their phone opens the job's damage report with the area and category filled in. If they submit the form without submitting that report, a private damage case is opened from this answer (the same case the form opens for reported damage). The client does not see it until the office releases it.`;
}

/** What "Test as cleaner" says the answer WOULD do (the sandbox does none of it). */
export function wouldHappenSentence(plan: SubmissionEffectsPlan): string[] {
  const lines: string[] = [];
  for (const request of plan.urgentStock) {
    lines.push(`Would raise an urgent stock need: "${request.label}" counted ${request.count}${request.unit ? ` ${request.unit}` : ""}, below ${request.threshold}.`);
  }
  for (const prompt of plan.damage) {
    lines.push(`Would open a damage report: "${prompt.label}" answered ${prompt.when === "yes" ? "Yes" : "No"}${prompt.area ? ` (area: ${prompt.area})` : ""}.`);
  }
  return lines;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * What a submitted (or test) answer set asks for. The first visible question
 * per stock item wins (the strict check refuses two questions on one item, so
 * this only guards an old or hand-made schema from double counting).
 */
export function planSubmissionEffects(
  schema: unknown,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  laundryReady?: boolean,
): SubmissionEffectsPlan {
  const plan: SubmissionEffectsPlan = { stockCounts: [], urgentStock: [], damage: [] };
  const seenItems = new Set<string>();
  const sections = isNode(schema) && Array.isArray(schema.sections) ? schema.sections : [];
  for (const section of sections as any[]) {
    if (!isTemplateNodeVisible(section, answers, property, laundryReady)) continue;
    const sectionTitle = text(section?.title) || text(section?.label);
    for (const field of flattenFieldsOneLevel(section?.fields)) {
      if (!field?.id || !isFlattenedFieldVisible(field, answers, property, laundryReady)) continue;
      const id = String(field.id);
      const label = text(field.label) || id;
      if (field.type === "stock_count") {
        const answer = readStockCountAnswer(answers[id]);
        if (!answer || answer.itemId !== field.stockItemId || seenItems.has(answer.itemId)) continue;
        seenItems.add(answer.itemId);
        const observation: StockCountObservation = {
          fieldId: id,
          label,
          itemId: answer.itemId,
          itemName: text(field.stockItemName) || null,
          unit: text(field.unit) || null,
          count: answer.count,
        };
        plan.stockCounts.push(observation);
        const effect = urgentStockEffectOf(field);
        if (effect && answer.count < effect.threshold) plan.urgentStock.push({ ...observation, threshold: effect.threshold });
      }
      const damage = damageEffectOf(field);
      if (damage && yesNoMatches(answers[id], damage.when)) {
        plan.damage.push({
          fieldId: id,
          label,
          when: damage.when,
          area: text(damage.area) || text(field.locationTag) || sectionTitle,
          category: text(damage.category),
        });
      }
    }
  }
  return plan;
}

/** True when the schema uses any effect or structured type (gates the submit route's extra work). */
export function schemaUsesEffectsOrStockCounts(schema: unknown): boolean {
  const sections = isNode(schema) && Array.isArray(schema.sections) ? schema.sections : [];
  return sections.some((section) =>
    isNode(section) &&
    flattenFieldsOneLevel(section.fields).some((field: Node) => field?.type === "stock_count" || fieldEffects(field).length > 0),
  );
}
