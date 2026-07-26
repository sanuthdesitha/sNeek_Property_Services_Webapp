/**
 * Named marketing audiences ("segments").
 *
 * Design: the *decision* for every client-based segment is a PURE predicate over
 * a small `SegmentClientFacts` record. `resolveSegment()` runs one query to build
 * those facts for every active client, then applies the predicate. That split is
 * deliberate — the predicates are unit-testable with plain objects (see
 * tests/lib/segments.test.ts) and the database shape can change without
 * rewriting the audience rules.
 *
 * The lead segment is the exception: leads live on QuoteLead, not Client, so it
 * has its own loader. Its predicate still operates on plain facts.
 *
 * Consumed by:
 *  - lib/marketing/email-campaigns.ts + lib/marketing/campaign-sender.ts, via the
 *    `{ type: "segment", filters: { segmentId } }` audience shape.
 *  - /api/admin/marketing/segments, which returns the definitions plus a live
 *    recipient count so the campaign editor can show the size before sending.
 */
import { db } from "@/lib/db";
import { ClientInvoiceStatus, JobStatus, LeadStatus } from "@prisma/client";

export type SegmentId =
  | "all_active_clients"
  | "clients_with_job_last_90d"
  | "dormant_90d"
  | "airbnb_property_clients"
  | "clients_with_active_recurring"
  | "leads_only";

export type SegmentSource = "client" | "lead";

/** The minimal, flat set of facts every client predicate is allowed to see. */
export type SegmentClientFacts = {
  clientId: string;
  name: string;
  email: string;
  phone: string;
  isActive: boolean;
  /** Most recent completed/invoiced job date across all of the client's properties. */
  lastJobAt: Date | null;
  /** Most recent billing activity, used as a fallback signal when there are no jobs. */
  lastInvoiceAt: Date | null;
  /** Distinct JobType values this client has ever had completed. */
  jobTypes: string[];
  /** True when any property has an enabled calendar (iCal) integration. */
  hasCalendarIntegration: boolean;
  /** True when any property carries a `recurringSchedule` config blob. */
  hasRecurringSchedule: boolean;
};

export type SegmentLeadFacts = {
  leadId: string;
  name: string;
  email: string;
  phone: string;
  /** Set when the lead was later linked to a real client record. */
  clientId: string | null;
  status: string;
  createdAt: Date;
};

export type SegmentRecipient = {
  /** Client id, or null for lead-sourced recipients. */
  clientId: string | null;
  leadId?: string | null;
  name: string;
  email: string;
  phone: string;
};

export type SegmentDefinition = {
  id: SegmentId;
  label: string;
  description: string;
  source: SegmentSource;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return (now.getTime() - new Date(date).getTime()) / DAY_MS;
}

// ─────────────────────────────────────────────────────── pure predicates ──

export const CLIENT_SEGMENT_PREDICATES: Record<
  Exclude<SegmentId, "leads_only">,
  (facts: SegmentClientFacts, now: Date) => boolean
> = {
  /** Every active client we can actually email. */
  all_active_clients: (facts) => facts.isActive && Boolean(facts.email),

  /** Worked with us recently — the warm list for review asks and referrals. */
  clients_with_job_last_90d: (facts, now) => {
    if (!facts.isActive || !facts.email) return false;
    const days = daysSince(facts.lastJobAt, now);
    return days !== null && days <= 90;
  },

  /**
   * Gone quiet. A client with NO job history at all counts as dormant only if
   * their billing history is also stale (or absent) — otherwise a brand-new
   * client who has not been serviced yet would be win-back-emailed on day one.
   */
  dormant_90d: (facts, now) => {
    if (!facts.isActive || !facts.email) return false;
    const jobDays = daysSince(facts.lastJobAt, now);
    if (jobDays !== null) return jobDays > 90;
    const invoiceDays = daysSince(facts.lastInvoiceAt, now);
    if (invoiceDays !== null) return invoiceDays > 90;
    return false;
  },

  /**
   * Short-stay operators. Either they have had an Airbnb turnover done, or a
   * property of theirs is synced to a booking calendar — both are strong,
   * self-declared signals of a short-stay property.
   */
  airbnb_property_clients: (facts) => {
    if (!facts.isActive || !facts.email) return false;
    return facts.hasCalendarIntegration || facts.jobTypes.includes("AIRBNB_TURNOVER");
  },

  /** On an ongoing arrangement — the loyal core. */
  clients_with_active_recurring: (facts) => {
    if (!facts.isActive || !facts.email) return false;
    return facts.hasRecurringSchedule || facts.jobTypes.includes("COMMERCIAL_RECURRING");
  },
};

/** Quote-only contacts: they asked for a price but never became a client. */
export function leadOnlyPredicate(facts: SegmentLeadFacts): boolean {
  if (!facts.email) return false;
  if (facts.clientId) return false;
  return facts.status !== LeadStatus.CONVERTED && facts.status !== LeadStatus.LOST;
}

export const SEGMENTS: SegmentDefinition[] = [
  {
    id: "all_active_clients",
    label: "All active clients",
    description: "Every active client with an email address on file.",
    source: "client",
  },
  {
    id: "clients_with_job_last_90d",
    label: "Serviced in the last 90 days",
    description: "Clients with a completed or invoiced job in the last 90 days — the warm list.",
    source: "client",
  },
  {
    id: "dormant_90d",
    label: "Dormant 90+ days",
    description: "Active clients whose last job (or last invoice) is more than 90 days old.",
    source: "client",
  },
  {
    id: "airbnb_property_clients",
    label: "Airbnb / short-stay hosts",
    description: "Clients with a booking-calendar integration or a history of Airbnb turnovers.",
    source: "client",
  },
  {
    id: "clients_with_active_recurring",
    label: "Recurring-schedule clients",
    description: "Clients with a recurring schedule configured on a property, or recurring commercial work.",
    source: "client",
  },
  {
    id: "leads_only",
    label: "Leads (quote-only, never converted)",
    description: "Quote requests that never became a client and are not marked converted or lost.",
    source: "lead",
  },
];

export function getSegment(id: string): SegmentDefinition | null {
  return SEGMENTS.find((segment) => segment.id === id) ?? null;
}

export function isSegmentId(value: unknown): value is SegmentId {
  return typeof value === "string" && SEGMENTS.some((segment) => segment.id === value);
}

// ──────────────────────────────────────────────────── fact loaders + run ──

function pickEmail(row: { email: string | null; users: Array<{ email: string | null }> }): string {
  return row.users.find((user) => user.email?.trim())?.email?.trim() || row.email?.trim() || "";
}

function pickPhone(row: { phone: string | null; users: Array<{ phone: string | null }> }): string {
  return row.users.find((user) => user.phone?.trim())?.phone?.trim() || row.phone?.trim() || "";
}

/** One query → the flat facts every client predicate needs. */
export async function loadClientFacts(): Promise<SegmentClientFacts[]> {
  const clients = await db.client.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      users: { where: { isActive: true }, select: { email: true, phone: true } },
      properties: {
        select: {
          recurringSchedule: true,
          integration: { select: { isEnabled: true, icalUrl: true } },
          jobs: {
            where: { status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] } },
            select: { scheduledDate: true, jobType: true },
            orderBy: { scheduledDate: "desc" },
          },
        },
      },
      invoices: {
        where: {
          status: {
            in: [ClientInvoiceStatus.PAID, ClientInvoiceStatus.SENT, ClientInvoiceStatus.APPROVED],
          },
        },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return clients.map((client) => {
    const jobs = client.properties.flatMap((property) => property.jobs);
    const jobTypes = Array.from(new Set(jobs.map((job) => String(job.jobType))));
    const lastJobAt = jobs.reduce<Date | null>((latest, job) => {
      if (!job.scheduledDate) return latest;
      const date = new Date(job.scheduledDate);
      return !latest || date > latest ? date : latest;
    }, null);

    return {
      clientId: client.id,
      name: client.name,
      email: pickEmail(client),
      phone: pickPhone(client),
      isActive: client.isActive,
      lastJobAt,
      lastInvoiceAt: client.invoices[0]?.createdAt ? new Date(client.invoices[0].createdAt) : null,
      jobTypes,
      hasCalendarIntegration: client.properties.some(
        (property) => Boolean(property.integration?.isEnabled) && Boolean(property.integration?.icalUrl),
      ),
      hasRecurringSchedule: client.properties.some(
        (property) => property.recurringSchedule !== null && property.recurringSchedule !== undefined,
      ),
    } satisfies SegmentClientFacts;
  });
}

export async function loadLeadFacts(): Promise<SegmentLeadFacts[]> {
  const leads = await db.quoteLead.findMany({
    select: { id: true, name: true, email: true, phone: true, clientId: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  return leads.map((lead) => ({
    leadId: lead.id,
    name: lead.name,
    email: (lead.email ?? "").trim(),
    phone: (lead.phone ?? "").trim(),
    clientId: lead.clientId,
    status: String(lead.status),
    createdAt: new Date(lead.createdAt),
  }));
}

/** Dedupe by lowercase email — one person never gets the same broadcast twice. */
function dedupeByEmail(recipients: SegmentRecipient[]): SegmentRecipient[] {
  const seen = new Map<string, SegmentRecipient>();
  for (const recipient of recipients) {
    const key = recipient.email.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, recipient);
  }
  return Array.from(seen.values());
}

/** Resolve a named segment to a deduped recipient list. */
export async function resolveSegment(
  segmentId: SegmentId,
  now: Date = new Date(),
): Promise<{ segment: SegmentDefinition; recipients: SegmentRecipient[]; count: number }> {
  const segment = getSegment(segmentId);
  if (!segment) throw new Error(`Unknown segment: ${segmentId}`);

  if (segment.source === "lead") {
    const facts = await loadLeadFacts();
    const recipients = dedupeByEmail(
      facts.filter(leadOnlyPredicate).map((lead) => ({
        clientId: null,
        leadId: lead.leadId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
      })),
    );
    return { segment, recipients, count: recipients.length };
  }

  const predicate = CLIENT_SEGMENT_PREDICATES[segmentId as Exclude<SegmentId, "leads_only">];
  const facts = await loadClientFacts();
  const recipients = dedupeByEmail(
    facts
      .filter((row) => predicate(row, now))
      .map((row) => ({
        clientId: row.clientId,
        leadId: null,
        name: row.name,
        email: row.email,
        phone: row.phone,
      })),
  );
  return { segment, recipients, count: recipients.length };
}

/** Recipient counts for every segment — powers the audience picker. */
export async function resolveAllSegmentCounts(
  now: Date = new Date(),
): Promise<Array<SegmentDefinition & { count: number }>> {
  const clientFacts = await loadClientFacts();
  const leadFacts = await loadLeadFacts();

  return SEGMENTS.map((segment) => {
    if (segment.source === "lead") {
      const emails = new Set(
        leadFacts.filter(leadOnlyPredicate).map((lead) => lead.email.toLowerCase()),
      );
      return { ...segment, count: emails.size };
    }
    const predicate = CLIENT_SEGMENT_PREDICATES[segment.id as Exclude<SegmentId, "leads_only">];
    const emails = new Set(
      clientFacts.filter((row) => predicate(row, now)).map((row) => row.email.toLowerCase()).filter(Boolean),
    );
    return { ...segment, count: emails.size };
  });
}
