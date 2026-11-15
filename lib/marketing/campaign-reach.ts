/**
 * Campaign reach BEFORE sending (board "Marketing", 2026-11-16): how many
 * people the audience matches, how many will be sent, and how many are skipped
 * because they unsubscribed, are on the bounce/complaint list, or have no email
 * address. The counts are a preview; the sender checks every address again when
 * it sends (isMarketingSuppressed and the sending safeguards).
 */
import { db } from "@/lib/db";
import { normalizeCampaignAudience, type EmailCampaignAudience } from "./campaign-audience";
import { resolveEmailCampaignRecipients } from "./email-campaigns";
import {
  CLIENT_SEGMENT_PREDICATES,
  getSegment,
  leadOnlyPredicate,
  loadClientFacts,
  loadLeadFacts,
  type SegmentClientFacts,
  type SegmentId,
} from "./segments";
import { skipReasonsFor, type SkipReason } from "./campaign-skips";

export type CampaignReach = {
  /** Distinct addresses the audience resolves to (people with an email). */
  withEmail: number;
  willSend: number;
  unsubscribed: number;
  bounceList: number;
  /** Matching clients or leads that have no email address at all. */
  noEmail: number;
};

const PLACEHOLDER_EMAIL = "placeholder@example.invalid";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Legacy (non-segment) audience rules, the same as resolveEmailCampaignRecipients, over flat facts. */
export function legacyAudienceMatches(facts: SegmentClientFacts, audience: EmailCampaignAudience, now: Date): boolean {
  if (!facts.isActive) return false;
  if (audience.type === "inactive_clients") {
    const days = Math.max(1, Number(audience.filters?.daysSinceLastBooking ?? 60));
    const latest = facts.lastJobAt ?? facts.lastInvoiceAt;
    if (!latest) return true;
    return now.getTime() - latest.getTime() >= days * DAY_MS;
  }
  if (audience.type === "service_type") {
    const allowed = new Set((audience.filters?.jobTypes ?? []).map((item) => item.trim()).filter(Boolean));
    if (allowed.size === 0) return false;
    return facts.jobTypes.some((jobType) => allowed.has(jobType));
  }
  return true;
}

/** People the audience would match if they had an email address, who do not. */
export async function countWithoutEmail(audience: EmailCampaignAudience, now: Date = new Date()): Promise<number> {
  if (audience.type === "single_recipient") return 0;
  if (audience.type === "segment") {
    const segmentId = audience.filters?.segmentId as SegmentId | undefined;
    const segment = segmentId ? getSegment(segmentId) : null;
    if (!segment) return 0;
    if (segment.source === "lead") {
      const leads = await loadLeadFacts();
      return leads.filter((lead) => !lead.email && leadOnlyPredicate({ ...lead, email: PLACEHOLDER_EMAIL })).length;
    }
    const predicate = CLIENT_SEGMENT_PREDICATES[segment.id as Exclude<SegmentId, "leads_only">];
    const facts = await loadClientFacts();
    return facts.filter((row) => !row.email && predicate({ ...row, email: PLACEHOLDER_EMAIL }, now)).length;
  }
  const facts = await loadClientFacts();
  return facts.filter((row) => !row.email && legacyAudienceMatches(row, audience, now)).length;
}

/** Pure: totals from the addresses and their skip reasons. */
export function summariseReach(emails: string[], reasons: Map<string, SkipReason>, noEmail: number): CampaignReach {
  let unsubscribed = 0;
  let bounceList = 0;
  for (const email of emails) {
    const reason = reasons.get(email.toLowerCase());
    if (reason === "unsubscribed") unsubscribed += 1;
    else if (reason === "bounce_list") bounceList += 1;
  }
  return { withEmail: emails.length, willSend: emails.length - unsubscribed - bounceList, unsubscribed, bounceList, noEmail };
}

export async function computeCampaignReach(audienceInput: unknown, now: Date = new Date()): Promise<CampaignReach> {
  const audience = normalizeCampaignAudience(audienceInput);
  const [{ recipients }, noEmail] = await Promise.all([resolveEmailCampaignRecipients(audience), countWithoutEmail(audience, now)]);
  const emails = recipients.map((recipient) => recipient.email.toLowerCase()).filter(Boolean);
  const reasons = await skipReasonsFor(emails);
  return summariseReach(emails, reasons, noEmail);
}

export type CampaignSendCounts = { sent: number; failed: number; skipped: number };

/** Per-campaign ledger counts (sent, failed, skipped) in one grouped query. */
export async function campaignSendCounts(campaignIds: string[]): Promise<Record<string, CampaignSendCounts>> {
  const ids = Array.from(new Set(campaignIds.filter(Boolean)));
  const result: Record<string, CampaignSendCounts> = {};
  if (ids.length === 0) return result;
  const rows = await db.campaignSend.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: ids } }, _count: { _all: true } });
  for (const row of rows) {
    const entry = (result[row.campaignId] ??= { sent: 0, failed: 0, skipped: 0 });
    if (row.status === "SENT") entry.sent += row._count._all;
    else if (row.status === "FAILED") entry.failed += row._count._all;
    else if (row.status === "SKIPPED") entry.skipped += row._count._all;
  }
  return result;
}
