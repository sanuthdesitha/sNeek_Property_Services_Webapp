/**
 * The browser-side draft of a rule change: plain helpers (no "use client", no
 * server imports) shared by the Scheduling rules screen and its tests.
 */
import type { EditableRuleKey } from "./values";
import type { RuleSpecView } from "./view-types";

export type DraftValues = Record<EditableRuleKey, number | boolean | string>;

export type DraftOrigin =
  | { kind: "EDIT" }
  | { kind: "RESTORE"; restoredFromVersion: number }
  | { kind: "IMPORT"; label: string };

export type RuleDraft = {
  values: DraftValues;
  origin: DraftOrigin;
  /** The latest version the draft was started from (sent back for the stale check). */
  baseVersion: number;
};

/** Parse what a person typed into the stored type; null when it is not acceptable. */
export function parseDraftInput(spec: RuleSpecView, raw: string | boolean): number | boolean | string | null {
  if (spec.type === "boolean") return typeof raw === "boolean" ? raw : raw === "true";
  if (spec.type === "time") {
    const text = String(raw).trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
  }
  const text = String(raw).trim();
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  if (spec.min !== undefined && value < spec.min) return null;
  if (spec.max !== undefined && value > spec.max) return null;
  return value;
}

export type DraftChange = { key: EditableRuleKey; from: number | boolean | string; to: number | boolean | string };

export function draftChanges(live: DraftValues, draft: DraftValues): DraftChange[] {
  return (Object.keys(live) as EditableRuleKey[]).filter((key) => live[key] !== draft[key]).map((key) => ({ key, from: live[key], to: draft[key] }));
}

export function boundsText(spec: RuleSpecView): string | null {
  if (spec.type !== "integer") return null;
  if (spec.min === undefined || spec.max === undefined) return null;
  return `${spec.min} to ${spec.max}${spec.unit && spec.unit !== "%" ? ` ${spec.unit}` : spec.unit === "%" ? "%" : ""}`;
}
