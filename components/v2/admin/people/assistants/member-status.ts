/** Labels and tones for an assistant's status. Plain module. */
import type { EPillTone } from "@/components/v2/ui/pill";
import type { AssistantMemberStatus } from "@/lib/people/assistants";

export const MEMBER_STATUS_LABEL: Record<AssistantMemberStatus, string> = {
  ACTIVE: "Active",
  INVITED: "Invited",
  INVITE_EXPIRED: "Invite expired",
  SUSPENDED: "Suspended",
  TEAM_OFF: "Team off",
};

export const MEMBER_STATUS_TONE: Record<AssistantMemberStatus, EPillTone> = {
  ACTIVE: "ok",
  INVITED: "info",
  INVITE_EXPIRED: "bad",
  SUSPENDED: "bad",
  TEAM_OFF: "warn",
};

/** An assistant who can act now: active, on a team that is on. */
export function mayAct(status: AssistantMemberStatus): boolean {
  return status === "ACTIVE";
}
