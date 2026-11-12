/**
 * The laundry portal "From the office" inbox read model. PLAIN module (no
 * "use client", no server imports): the server page, the API route and the
 * client inbox all read these types and labels.
 */
import type { LaundryTeamRequestKind } from "./nudge-rules";
import type { TeamReplyAnswer, TeamReplySummary } from "./team-request-reply-rules";

/** open: still to answer · answered: a typed answer settled it · done: the run no longer calls for it. */
export type OfficeRequestState = "open" | "answered" | "done";

export type LaundryOfficeRequest = {
  id: string;
  taskId: string;
  kind: LaundryTeamRequestKind;
  /** The badge: "Photo needed", "Confirm pickup", "Drop time", "Chase". */
  badge: string;
  /** "Glebe House drop-off" / "Coogee Terrace moved to 15:30". */
  title: string;
  /** The request sentence the office sent. */
  text: string;
  note: string | null;
  askedAtLabel: string;
  /** ISO instant the office asked. */
  askedAt: string;
  propertyName: string;
  state: OfficeRequestState;
  /** 2 for the second request of this kind for the run in the window. */
  reminderNumber: number;
  /** Move pickup: the time the office proposed. */
  proposedTime: string | null;
  /** The run's planned clock time for the leg this request is about, when planned. */
  plannedTime: string | null;
  /** Which stop the run's own action is on. */
  stopKind: "PICKUP" | "DROP";
  /** Typed answers this request accepts. */
  answers: readonly TeamReplyAnswer[];
  replies: TeamReplySummary[];
  /** The run as it is now (2026-11-13 portal entries: weight / price, ready to return, drop-off photo). Optional for older readers. */
  run?: { status: string; updatedAt: string; bagWeightKg: number | null; dropoffCostAud: number | null };
};

export type OfficeRequestsResponse = { requests: LaundryOfficeRequest[]; openCount: number; windowHours: number };

export const OFFICE_REQUEST_BADGES: Record<LaundryTeamRequestKind, { label: string; tone: "warning" | "info" | "danger" }> = {
  TEAM_PHOTO: { label: "Photo needed", tone: "warning" },
  TEAM_CONFIRM_PICKUP: { label: "Confirm pickup", tone: "info" },
  TEAM_MOVE_PICKUP: { label: "Confirm pickup", tone: "info" },
  TEAM_CONFIRM_DROP: { label: "Drop time", tone: "info" },
  TEAM_RETURN_ETA: { label: "Chase", tone: "danger" },
};

export const LAUNDRY_REQUESTS_HREF = "/v2/laundry/requests";

export function stopHref(taskId: string, kind: "PICKUP" | "DROP"): string {
  return `/v2/laundry/stop/${encodeURIComponent(taskId)}?kind=${kind === "PICKUP" ? "pickup" : "drop"}`;
}
