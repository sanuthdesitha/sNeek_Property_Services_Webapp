// Pure (no db) FSM for case lifecycle. Safe to import from client + tests.

export type CaseState =
  | "OPEN"
  | "TRIAGE"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "AWAITING_CLIENT"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED";

export const CASE_STATE_ORDER: CaseState[] = [
  "OPEN",
  "TRIAGE",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_CLIENT",
  "RESOLVED",
  "CLOSED",
];

const VALID_TRANSITIONS: Record<CaseState, CaseState[]> = {
  OPEN: ["TRIAGE", "CANCELLED"],
  TRIAGE: ["ASSIGNED", "RESOLVED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "AWAITING_CLIENT", "CANCELLED"],
  IN_PROGRESS: ["AWAITING_CLIENT", "RESOLVED", "CANCELLED"],
  AWAITING_CLIENT: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(from: CaseState, to: CaseState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validNextStates(from: CaseState): CaseState[] {
  return VALID_TRANSITIONS[from] ?? [];
}

export function caseStateLabel(s: CaseState): string {
  switch (s) {
    case "OPEN":
      return "Open";
    case "TRIAGE":
      return "Triage";
    case "ASSIGNED":
      return "Assigned";
    case "IN_PROGRESS":
      return "In Progress";
    case "AWAITING_CLIENT":
      return "Awaiting Client";
    case "RESOLVED":
      return "Resolved";
    case "CLOSED":
      return "Closed";
    case "CANCELLED":
      return "Cancelled";
  }
}
