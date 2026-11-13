/**
 * The JSON the Scheduling rules screen reads (GET /api/admin/settings/scheduling-rules).
 * Plain module: types only.
 */
import type { RuleDomain, RuleKind, RuleTakesEffect } from "./registry";
import type { EditableRuleKey } from "./values";

export type RuleRowView = {
  id: string;
  domain: RuleDomain;
  section: string;
  title: string;
  kind: RuleKind;
  editableKey: EditableRuleKey | null;
  valueText: string;
  sentence: string;
  appliesTo: string;
  takesEffect: RuleTakesEffect;
  origin: string;
  quirk: string | null;
  /** Set when a scheduled (not yet live) version will change this value. */
  scheduledValueText: string | null;
};

export type RuleVersionView = {
  version: number;
  kind: "ORIGINAL" | "EDIT" | "RESTORE" | "IMPORT";
  label: string;
  effectiveFrom: string;
  effectiveLabel: string;
  appliesToExisting: boolean;
  reason: string;
  restoredFromVersion: number | null;
  createdAt: string;
  createdBy: string | null;
  status: "LIVE" | "SCHEDULED" | "SUPERSEDED";
  changeCount: number;
  values: Record<EditableRuleKey, number | boolean | string>;
};

export type RuleSpecView = { type: "integer" | "boolean" | "time"; min?: number; max?: number; unit?: string };

export type SchedulingRulesView = {
  liveVersion: number;
  latestVersion: number;
  liveEffectiveLabel: string;
  rules: RuleRowView[];
  versions: RuleVersionView[];
  specs: Record<EditableRuleKey, RuleSpecView>;
  /** Setting-backed rules whose settings row no longer matches the live version. */
  drift: EditableRuleKey[];
  workerSchedule: ReadonlyArray<{ name: string; when: string; does: string }>;
  canEdit: boolean;
  earliestEffectiveFrom: string;
  coolDownUntil: string | null;
  timezone: string;
  readAt: string;
};
