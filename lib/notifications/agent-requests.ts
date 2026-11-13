import "server-only";
/**
 * "An agent request is waiting" (step 6, 2026-11-14; catalog
 * `agent.action_request`): an INBOX-only notice, through the notification
 * intent pipeline, to the people who could approve it (scope
 * AGENT_ACTION_APPROVER, re-checked when queued and again at dispatch). Never
 * an email, SMS or device push. Queued is not delivered: the caller keeps the
 * outcomes and never claims delivery. One event per request (event id), so a
 * repeated call is one pipeline event.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "./office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "./type-controls";
import { loadNotificationWording } from "./wording/render";

export const AGENT_REQUEST_NOTICE_TYPE = "agent.action_request";
export const AGENT_REQUESTS_URL = "/v2/admin/approvals?tab=agents";

export type AgentRequestNotice = { requestId: string; agentName: string; summary: string };

async function possibleApprovers(): Promise<OfficeRecipient[]> {
  return db.user.findMany({
    where: { isActive: true, role: { in: [Role.ADMIN, Role.OPS_MANAGER] } },
    select: { id: true, role: true, name: true, email: true },
  });
}

export async function sendAgentRequestNotice(input: AgentRequestNotice): Promise<RecipientOutcome[]> {
  const recipients = await possibleApprovers();
  if (recipients.length === 0) return [];
  const typeKey = AGENT_REQUEST_NOTICE_TYPE;
  const wording = await loadNotificationWording(typeKey);
  const inbox = wording.render("waiting", "INBOX", { agentName: input.agentName, summary: input.summary });
  const controls = await getNotificationTypeControls();
  return sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `agent-request:${input.requestId}`,
    entity: { type: "AgentActionRequest", id: input.requestId }, actorId: null,
    scopeType: "AGENT_ACTION_APPROVER", scopeId: () => input.requestId,
    category: "approvals", severity: "ACTION", jobId: null,
    subject: inbox.title, body: inbox.body, url: AGENT_REQUESTS_URL,
    transports: ["INBOX"], recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
}
