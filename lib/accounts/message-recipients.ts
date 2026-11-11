/**
 * Who a bulk "Message" from Accounts would reach, worked out before sending
 * with the same rules the staff message route applies (active staff accounts
 * only). The route checks again; this only lets the screen say up front who
 * will be skipped and why.
 */
import { STAFF_MESSAGE_ROLES } from "@/lib/notifications/staff-roles";
import type { AccountRow } from "./list/types";

export type MessageRecipientPlan = {
  recipients: AccountRow[];
  skipped: Array<{ row: AccountRow; reason: string }>;
};

export function planStaffMessage(rows: AccountRow[]): MessageRecipientPlan {
  const plan: MessageRecipientPlan = { recipients: [], skipped: [] };
  for (const row of rows) {
    if (!STAFF_MESSAGE_ROLES.includes(row.role)) plan.skipped.push({ row, reason: row.role === "CLIENT" ? "Client login: message clients from the job or Cases." : "Not a staff account." });
    else if (row.status === "DISABLED") plan.skipped.push({ row, reason: "Account is disabled." });
    else plan.recipients.push(row);
  }
  return plan;
}
