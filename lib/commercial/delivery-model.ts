/**
 * Client delivery profiles: who receives each client's job reports and
 * invoices by email (board "Delivery profiles", 2026-11-16). Plain module: the
 * server overview, the routes and the screen share these shapes and rules.
 *
 * The routes are the ones the send paths really use
 * (lib/commercial/delivery-profiles.ts `resolveClientDeliveryRecipients`):
 * "Share report" on a job and "Send" on an invoice go to the profile's list for
 * that kind PLUS the client's own email on file; with an empty list, to the
 * client email alone. Documents sent from the client page use the list, or the
 * client's portal users when it is empty. Email is the only transport.
 *
 * Results come from the sending log (one row per address): Queued, Handed
 * over, Failed, Not sent, or Unknown when the provider's answer was unclear.
 * Queued is never delivered; "Handed over" means the email service accepted
 * it, not that it was read.
 */

export type DeliveryKind = "report" | "invoice";

export type AddressSource = "profile" | "client_email";

export type BounceMark = { reason: string; since: string | null };

export type DeliveryAddress = {
  email: string;
  source: AddressSource;
  bounce: BounceMark | null;
};

export type SendResult = "queued" | "handed_over" | "failed" | "not_sent" | "unknown";

export const SEND_RESULT_WORDS: Record<SendResult, string> = {
  queued: "Queued",
  handed_over: "Handed over",
  failed: "Failed",
  not_sent: "Not sent",
  unknown: "Unknown",
};

export const SEND_RESULT_MEANING: Record<SendResult, string> = {
  queued: "waiting to go. Not delivered.",
  handed_over: "the email service accepted it. Opens are not tracked for these emails.",
  failed: "the email service refused it or could not be reached, with the reason. Send it again from the invoice or the job.",
  not_sent: "a sending safeguard stopped it, or the address is on the bounce list. Fix it here, or remove it from the list in System health › Email.",
  unknown: "the email service did not answer clearly; it may or may not have gone. Check before sending again.",
};

/** One sending-log row (OutboundMessageEvent) mapped to a result. */
export function sendResultFor(decision: string, outcome: string | null): SendResult {
  if (decision === "SUPPRESSED") return "not_sent";
  if (decision === "HELD") return "queued";
  if (outcome === "ACCEPTED") return "handed_over";
  if (outcome === "NOT_ACCEPTED") return "failed";
  if (outcome === "UNCERTAIN") return "unknown";
  // Allowed (or released) with no provider answer recorded yet.
  return "queued";
}

export type DeliveryProfileView = {
  reportRecipients: string[];
  invoiceRecipients: string[];
  /** Stored but read by nothing: shown as "Not in use". */
  autoSendReports: boolean;
  autoSendInvoices: boolean;
  /** The stale-write token: null when no profile was ever saved. */
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
};

export type DeliveryRoute = {
  /** The profile's own list for this kind. */
  custom: DeliveryAddress[];
  /** Always added (the client's email on file), or used alone when the list is empty. */
  fallback: DeliveryAddress[];
};

export type LastSent = { at: string; subject: string | null; address: string; result: SendResult } | null;

export type DeliveryProblem = "bounce" | "no_invoice_address" | "no_report_address";

export type DeliveryOverviewRow = {
  client: {
    id: string;
    name: string;
    email: string | null;
    propertyCount: number;
    portalUsers: Array<{ name: string; email: string }>;
  };
  profile: DeliveryProfileView;
  reports: DeliveryRoute;
  invoices: DeliveryRoute;
  problems: DeliveryProblem[];
  lastSent: LastSent;
};

export type DeliveryOverview = {
  rows: DeliveryOverviewRow[];
  timeZone: string;
  canEdit: boolean;
  readOnlyReason: string | null;
};

export type RecentSend = {
  id: string;
  at: string;
  subject: string | null;
  address: string;
  result: SendResult;
  /** The safeguard reason in words, for "Not sent". */
  reason: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * The addresses a send of this kind goes to, as the send paths work them out:
 * the list for the kind, plus the client email (once, duplicates removed).
 */
export function deliveryRoute(list: string[], clientEmail: string | null, bounces: Map<string, BounceMark>): DeliveryRoute {
  const seen = new Set<string>();
  const custom: DeliveryAddress[] = [];
  for (const raw of list) {
    const email = normalizeAddress(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    custom.push({ email, source: "profile", bounce: bounces.get(email) ?? null });
  }
  const fallback: DeliveryAddress[] = [];
  const own = clientEmail ? normalizeAddress(clientEmail) : "";
  if (own && !seen.has(own)) fallback.push({ email: own, source: "client_email", bounce: bounces.get(own) ?? null });
  return { custom, fallback };
}

export function routeAddresses(route: DeliveryRoute): string[] {
  return [...route.custom, ...route.fallback].map((address) => address.email);
}

export function deliveryProblems(reports: DeliveryRoute, invoices: DeliveryRoute): DeliveryProblem[] {
  const problems: DeliveryProblem[] = [];
  if ([...reports.custom, ...reports.fallback, ...invoices.custom, ...invoices.fallback].some((address) => address.bounce)) problems.push("bounce");
  if (routeAddresses(invoices).length === 0) problems.push("no_invoice_address");
  if (routeAddresses(reports).length === 0) problems.push("no_report_address");
  return problems;
}

export type DeliveryFilter = "all" | "custom" | "fallback" | "problem";

export function matchesFilter(row: DeliveryOverviewRow, filter: DeliveryFilter): boolean {
  const custom = row.profile.reportRecipients.length > 0 || row.profile.invoiceRecipients.length > 0;
  if (filter === "custom") return custom;
  if (filter === "fallback") return !custom;
  if (filter === "problem") return row.problems.length > 0;
  return true;
}

export function matchesSearch(row: DeliveryOverviewRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (row.client.name.toLowerCase().includes(needle)) return true;
  return [...routeAddresses(row.reports), ...routeAddresses(row.invoices)].some((email) => email.includes(needle));
}

/** Plain CSV of the overview (who gets what); no send results or bounce reasons. */
export function deliveryCsv(rows: DeliveryOverviewRow[]): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [["Client", "Reports go to", "Report fallback", "Invoices go to", "Invoice fallback", "Auto-send (not in use)"].join(",")];
  for (const row of rows) {
    lines.push([
      row.client.name,
      row.reports.custom.map((address) => address.email).join("; "),
      row.reports.fallback.map((address) => address.email).join("; "),
      row.invoices.custom.map((address) => address.email).join("; "),
      row.invoices.fallback.map((address) => address.email).join("; "),
      row.profile.autoSendReports || row.profile.autoSendInvoices ? "stored on, not in use" : "off",
    ].map(escape).join(","));
  }
  return `${lines.join("\n")}\n`;
}
