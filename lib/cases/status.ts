export const CASE_STATUSES = [
  "OPEN",
  "TRIAGE",
  "INVESTIGATING",
  "WAITING_CLIENT",
  "WAITING_INTERNAL",
  "RESOLVED",
  "CLOSED",
] as const;

export type UnifiedCaseStatus = (typeof CASE_STATUSES)[number];

export function normalizeUnifiedCaseStatus(value: string | null | undefined): UnifiedCaseStatus {
  switch (String(value ?? "").trim().toUpperCase()) {
    case "TRIAGE":
      return "TRIAGE";
    case "IN_PROGRESS":
    case "INVESTIGATING":
      return "INVESTIGATING";
    case "WAITING_CLIENT":
      return "WAITING_CLIENT";
    case "WAITING_INTERNAL":
      return "WAITING_INTERNAL";
    case "RESOLVED":
      return "RESOLVED";
    case "CLOSED":
      return "CLOSED";
    default:
      return "OPEN";
  }
}

export function isCaseOpenStatus(status: string | null | undefined) {
  const normalized = normalizeUnifiedCaseStatus(status);
  return normalized !== "RESOLVED" && normalized !== "CLOSED";
}

export const CASE_STATUS_LABELS: Record<UnifiedCaseStatus, string> = {
  OPEN: "Open",
  TRIAGE: "Triage",
  INVESTIGATING: "Investigating",
  WAITING_CLIENT: "Waiting client",
  WAITING_INTERNAL: "Waiting internal",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};
