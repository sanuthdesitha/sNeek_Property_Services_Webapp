/**
 * CSV of the Accounts list as filtered and sorted on screen (every page, not
 * just the visible one). Only the columns the viewer may see are written:
 * no rate without pay visibility, no Jobs/QA without quality visibility, no rating/reliability/attendance/hours
 * without performance (workforce) visibility, and
 * never bank details, ABN, notes or sign-in secrets. A missing figure is
 * written empty, never 0. Pure.
 */
import { ROLE_LABELS } from "@/lib/auth/roles";
import { toCsv } from "@/lib/insights/csv";
import { ATTENTION_LABEL } from "./attention";
import type { AccountListVisibility, AccountRow } from "./types";

const STATUS_LABEL = { ACTIVE: "Active", INVITED: "Invited", DISABLED: "Disabled" } as const;

export function accountsCsv(rows: AccountRow[], visibility: AccountListVisibility): string {
  const header = ["Name", "Email", "Phone", "Role", "Extra roles", "Status", "Client"];
  if (visibility.pay) header.push("Hourly rate (AUD)");
  if (visibility.quality) header.push("Jobs, 30 d", "QA, 30 d");
  if (visibility.performance) header.push("Customer rating, 30 d", "Reliability %, 30 d", "Attendance %, 30 d", "Hours, 30 d");
  header.push("Documents", "Last seen (UTC)", "Needs attention");

  const body = rows.map((row) => {
    const cells: Array<string | number | null> = [
      row.name ?? "",
      row.email,
      row.phone ?? "",
      ROLE_LABELS[row.role],
      row.extraRoles.map((role) => ROLE_LABELS[role]).join("; "),
      STATUS_LABEL[row.status],
      row.clientName ?? "",
    ];
    if (visibility.pay) cells.push(row.rate ?? null);
    if (visibility.quality) cells.push(row.jobs30 ?? null, row.qa30 ?? null);
    if (visibility.performance) cells.push(row.rating ?? null, row.reliability ?? null, row.attendance ?? null, row.hours30 ?? null);
    cells.push(row.documents.label, row.lastSeenAt ?? "", row.attention.map((reason) => ATTENTION_LABEL[reason]).join("; "));
    return cells;
  });
  return toCsv(header, body);
}
