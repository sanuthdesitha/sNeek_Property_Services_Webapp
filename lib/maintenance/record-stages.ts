/**
 * The progress strip on the admin item page (board "Maintenance item"):
 * Reported · Acknowledged · Assigned · Visit booked · On site · Work done ·
 * Resolved. Mapped from stored facts only: "done" needs a recorded fact; a
 * step that left no record while a later one did is "passed", never "done";
 * the latest recorded step is "current" (where the item is now) until the
 * item is resolved. A dismissed item replaces the strip with one plain bar.
 *
 * PURE. Notes are formatted by the caller (organisation timezone).
 */
import type { EStage } from "@/components/v2/ui/stage-bar";

export type RecordStageInput = {
  status: string;
  createdAt: string | null;
  /** When the item first moved past Open, from its history; null when not recorded. */
  acknowledgedAt: string | null;
  assignedAt: string | null;
  /** Someone is on the item (visit worker or roster). */
  someoneAssigned: boolean;
  scheduledFor: string | null;
  arrivedAt: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  outcome: string | null;
  resolvedAt: string | null;
};

export const RECORD_STAGE_KEYS = ["reported", "acknowledged", "assigned", "visit", "on-site", "work-done", "resolved"] as const;
export type RecordStageKey = (typeof RECORD_STAGE_KEYS)[number];

const LABELS: Record<RecordStageKey, string> = {
  reported: "Reported",
  acknowledged: "Acknowledged",
  assigned: "Assigned",
  visit: "Visit booked",
  "on-site": "On site",
  "work-done": "Work done",
  resolved: "Resolved",
};

/** The recorded fact (an ISO time, or true) behind each step, or null. */
export function recordStageFacts(input: RecordStageInput): Record<RecordStageKey, string | boolean | null> {
  const movedOn = input.status !== "OPEN";
  return {
    reported: input.createdAt ?? true,
    acknowledged: input.acknowledgedAt ?? (movedOn ? true : null),
    assigned: input.someoneAssigned ? input.assignedAt ?? true : null,
    visit: input.scheduledFor,
    "on-site": input.arrivedAt ?? input.clockInAt,
    "work-done": input.clockOutAt ?? (input.outcome ? true : null),
    resolved: input.status === "RESOLVED" ? input.resolvedAt ?? true : null,
  };
}

export function maintenanceRecordStages(input: RecordStageInput, note: (key: RecordStageKey, fact: string | boolean | null) => string | null): EStage[] {
  const facts = recordStageFacts(input);
  const lastDone = RECORD_STAGE_KEYS.reduce((last, key, index) => (facts[key] ? index : last), -1);
  const resolved = Boolean(facts.resolved);
  return RECORD_STAGE_KEYS.map((key, index) => {
    const fact = facts[key];
    let state: EStage["state"];
    // The latest recorded step is where the item is now (the board's gold step).
    if (fact && index === lastDone && !resolved) state = "current";
    else if (fact) state = "done";
    else if (index < lastDone) state = "passed";
    else state = "todo";
    return { key, label: LABELS[key], state, note: note(key, fact) };
  });
}
