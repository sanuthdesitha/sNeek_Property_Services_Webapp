export const MAINTENANCE_STAGES = {
  OPEN: "Open", ACKNOWLEDGED: "Acknowledged", IN_PROGRESS: "In progress",
  ORDERED: "Parts ordered", RESOLVED: "Resolved", DISMISSED: "Dismissed",
} as const;

export type MaintenanceTicketSummary = {
  id: string; title: string; priority: string; status: string;
  scheduledFor: string | null; enRouteAt: string | null; arrivedAt: string | null;
  clockInAt: string | null; clockOutAt: string | null;
  outcome: string | null; costApprovalStatus: string | null;
  property: { name: string | null; suburb: string | null } | null;
};

/** A visit ending does not necessarily close a work order. */
export function maintenanceVisitStage(ticket: MaintenanceTicketSummary): string {
  if (ticket.status === "RESOLVED") return "Resolved";
  if (ticket.status === "DISMISSED") return "Dismissed";
  if (ticket.outcome === "NEEDS_PARTS") return "Needs parts";
  if (ticket.outcome === "NEEDS_FOLLOWUP") return "Needs follow-up";
  if (ticket.outcome === "NO_ACCESS") return "No access";
  if (ticket.clockOutAt || ticket.outcome) return "Visit ended; work order remains open";
  if (ticket.clockInAt) return "On site";
  if (ticket.arrivedAt) return "Arrived";
  if (ticket.enRouteAt) return "En route";
  return ticket.scheduledFor ? "Visit planned" : "Not scheduled";
}

export function maintenanceScheduleLabel(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Schedule unavailable";
  return date.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
}
