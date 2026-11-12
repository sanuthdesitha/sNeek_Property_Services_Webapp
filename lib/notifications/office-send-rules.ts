/**
 * Who may SEND the office messages that used to be administrator only
 * (owner decision, 2026-11-12: "Yes office should be able to").
 *
 * - ADMIN: always (an administrator never inherits a manager feature pack).
 * - OPS_MANAGER: only while their ops pack for the page the action lives on
 *   is at "Manage available actions" (the same level every other change on
 *   that page needs): Laundry for Chase supplier, Lost & found for the guest
 *   message and Tell client, Jobs for the client delay notice and the clock
 *   pause; Staff accounts for account emails (invitation, reset link, code).
 * - Nobody while impersonating: the message or pause must be recorded against
 *   the real person, and the target's restrictions apply.
 *
 * Pure, so the pages, the previews and the send routes answer the same way.
 * The server re-checks it on every send with the live session guards
 * (`office-send-permission.ts`); Copy stays available to everyone who can open
 * the record.
 */
import type { OpsFeature, OpsLevels } from "@/lib/rbac/ops-catalog";

export type OfficeSendAction =
  | "supplier_chase"
  | "guest_message"
  | "lost_item_client_notice"
  | "client_delay_notice"
  | "clock_pause"
  | "account_email"
  | "job_team_message";

export type OfficeActorRole = "ADMIN" | "OPS_MANAGER";

type ActionPolicy = {
  /** The ops pack that governs the page the action lives on. */
  pack: OpsFeature;
  /** The pack's name as the permission screen shows it. */
  packLabel: string;
  /** What is refused, for the 403 wording. */
  doing: string;
  /** What the person can do instead. */
  instead: string;
};

export const OFFICE_SEND_POLICIES: Record<OfficeSendAction, ActionPolicy> = {
  supplier_chase: {
    pack: "laundry",
    packLabel: "Laundry",
    doing: "chase a supplier from the app",
    instead: "Copy the message or open it in your email or phone app.",
  },
  guest_message: {
    pack: "lost-found",
    packLabel: "Lost & found",
    doing: "send a guest message from the app",
    instead: "Copy it or open it in your email or SMS app, then record that you sent it.",
  },
  lost_item_client_notice: {
    pack: "lost-found",
    packLabel: "Lost & found",
    doing: "send this to the client from the app",
    instead: "Copy it or open it in your email or SMS app, then record that you told the client.",
  },
  client_delay_notice: {
    pack: "jobs",
    packLabel: "Jobs & assignments",
    doing: "send the client delay notice",
    instead: "Use the job's Messages tab instead.",
  },
  clock_pause: {
    pack: "jobs",
    packLabel: "Jobs & assignments",
    doing: "pause a cleaner's clock",
    instead: "Use Review clock or call the cleaner instead.",
  },
  // "Message team" on a job: the cleaners assigned to it (owner decision 2026-11-13).
  job_team_message: {
    pack: "jobs",
    packLabel: "Jobs & assignments",
    doing: "message the job's team from the app",
    instead: "Call the cleaner or ask someone with Jobs access to send it.",
  },
  // Account emails (invitation, password reset link, sign-up code), 2026-11-12.
  account_email: {
    pack: "accounts",
    packLabel: "Staff accounts",
    doing: "send account emails",
    instead: "Ask an administrator to send it.",
  },
};

export type OfficeSendViewer = {
  /** Every role the signed-in (or impersonated) account holds. */
  heldRoles: readonly string[];
  impersonating: boolean;
  /** The manager's resolved pack levels; null for anyone who is not an ops subject. */
  levels: OpsLevels | null;
};

export type OfficeSendDecision =
  | { allowed: true; actorRole: OfficeActorRole; reason: null }
  | { allowed: false; actorRole: null; reason: string };

function refuse(reason: string): OfficeSendDecision {
  return { allowed: false, actorRole: null, reason };
}

/** Wording shown when an action is refused while impersonating. */
export function impersonationRefusal(action: OfficeSendAction): string {
  return action === "clock_pause"
    ? "A clock cannot be paused while impersonating."
    : "Messages cannot be sent while impersonating.";
}

export function decideOfficeSend(viewer: OfficeSendViewer, action: OfficeSendAction): OfficeSendDecision {
  const policy = OFFICE_SEND_POLICIES[action];
  if (viewer.impersonating) return refuse(`${impersonationRefusal(action)} ${policy.instead}`);
  if (viewer.heldRoles.includes("ADMIN")) return { allowed: true, actorRole: "ADMIN", reason: null };
  if (!viewer.heldRoles.includes("OPS_MANAGER")) return refuse(`Only administrators and operations managers can ${policy.doing}.`);
  // A manager always has resolved levels; anything else fails closed.
  if (!viewer.levels || viewer.levels[policy.pack] !== "manage") {
    return refuse(`Your ${policy.packLabel} permission does not allow you to ${policy.doing}. ${policy.instead}`);
  }
  return { allowed: true, actorRole: "OPS_MANAGER", reason: null };
}
