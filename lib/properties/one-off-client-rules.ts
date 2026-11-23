/**
 * Attaching a one-off site to its client: the rules, as pure functions.
 *
 * Why this exists (owner bug, 2026-11-23: "once off jobs can't be invoiced or
 * don't show under client properties or job history"). A one-off job made on
 * New job without choosing a client is filed under the catch-all client
 * "Unassigned / One-off Jobs" (lib/jobs/service-site.ts). Nothing could move it
 * afterwards: the job edit drops `clientId`, and a property's client cannot be
 * changed. So the job never reached the real client's properties, job history
 * or invoices. Attaching moves the SITE (and with it every job at the site) to
 * the chosen client.
 *
 * Deliberately narrow: only a one-off site (accessInfo.serviceSite === true)
 * that is still under the catch-all client. A managed property, or a one-off
 * site already under a real client, is never moved by this, because its
 * invoices, portal logins and history already belong to that client.
 */

export type AttachSiteFacts = {
  isOneOffSite: boolean;
  isActive: boolean;
  currentClientId: string;
  currentClientIsFallback: boolean;
};

export type AttachTargetFacts = {
  id: string;
  isActive: boolean;
  isFallback: boolean;
} | null;

/** Jobs at the site that are on a non-void client invoice (draft or issued). */
export type InvoicedSiteJob = { jobNumber: string | null; invoiceNumber: string | null };

export type AttachRefusal = { ok: false; status: 400 | 404 | 409; reason: string };
export type AttachDecision = { ok: true } | AttachRefusal;

export function attachClientDecision(site: AttachSiteFacts | null, target: AttachTargetFacts, invoiced: readonly InvoicedSiteJob[], billedShoppingCharges: number): AttachDecision {
  if (!site) return { ok: false, status: 404, reason: "Site not found." };
  if (!site.isOneOffSite) {
    return { ok: false, status: 400, reason: "Only a one-off site can be attached to a client here. A managed property keeps the client it was created for." };
  }
  if (!site.currentClientIsFallback) {
    return { ok: false, status: 409, reason: "This one-off site already belongs to a client. It is not moved from one client to another." };
  }
  if (!target) return { ok: false, status: 404, reason: "Choose a client that exists." };
  if (target.isFallback) return { ok: false, status: 400, reason: "Choose the real client, not “Unassigned / One-off Jobs”." };
  if (!target.isActive) return { ok: false, status: 400, reason: "That client is not active. Reactivate the client first, or choose another." };
  if (target.id === site.currentClientId) return { ok: false, status: 400, reason: "The site is already under that client." };
  if (invoiced.length > 0) {
    const named = invoiced
      .slice(0, 3)
      .map((row) => `${row.jobNumber ?? "a job"}${row.invoiceNumber ? ` (invoice ${row.invoiceNumber})` : ""}`)
      .join(", ");
    return {
      ok: false,
      status: 409,
      reason: `${named}${invoiced.length > 3 ? ` and ${invoiced.length - 3} more` : ""} already ${invoiced.length === 1 ? "is" : "are"} on an invoice for “Unassigned / One-off Jobs”. Void that invoice, or take the job off the draft, before attaching the client.`,
    };
  }
  if (billedShoppingCharges > 0) {
    return { ok: false, status: 409, reason: "Shopping at this site was already billed to “Unassigned / One-off Jobs”. Void that invoice before attaching the client." };
  }
  return { ok: true };
}

/** What moved, for the audit row and the confirmation the office sees. */
export type AttachMoveCounts = {
  jobs: number;
  jobTasks: number;
  cases: number;
  messages: number;
  ratings: number;
  feedback: number;
  locationPings: number;
  shoppingCharges: number;
};

export function attachSummary(counts: AttachMoveCounts, clientName: string): string {
  const jobs = `${counts.jobs} job${counts.jobs === 1 ? "" : "s"}`;
  return `Attached to ${clientName}. ${jobs} at this site now show under the client and can be invoiced to them.`;
}
