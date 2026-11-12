/**
 * Key facts and the most urgent item for the person page, from the profile
 * the page already loads (no new reads, nothing recomputed: the figures are
 * the profile's own summary and performance). Plain module.
 */
import type { PersonProfile } from "@/lib/accounts/person-types";
import type { EPillTone } from "@/components/v2/ui/pill";
import { DASH, formatMoney } from "@/components/v2/admin/accounts/hub/account-display";
import type { Fact } from "../fact-strip";

function pct(value: number | null | undefined): string | null {
  return typeof value === "number" ? `${Math.round(value)}%` : null;
}

export function personFacts(profile: PersonProfile): Fact[] {
  const s = profile.summary;
  const p = profile.performance;
  const facts: Fact[] = [];
  if (profile.figures) {
    facts.push({ key: "jobs", label: "Jobs, 30 d", value: profile.figures.jobs30 });
    facts.push({ key: "qa", label: "QA, 30 d", value: profile.figures.qa30 === null ? DASH : profile.figures.qa30.toFixed(0) });
  }
  if (p) {
    facts.push({ key: "ontime", label: "On time, 30 d", value: pct(p.onTimePercent) });
    facts.push({ key: "rating", label: "Rating, 30 d", value: p.avgRating === null ? null : p.avgRating.toFixed(1) });
    facts.push({ key: "rework", label: "Rework, 30 d", value: pct(p.reworkPercent) });
  }
  facts.push({ key: "month", label: "Jobs this month", value: s.jobsCompletedThisMonth });
  facts.push({ key: "hours", label: "Hours logged", value: s.hoursLoggedTotal });
  if (s.estimatedEarnings !== null) facts.push({ key: "earnings", label: "Est. earnings", value: formatMoney(s.estimatedEarnings) });
  return facts;
}

export type UrgentItem = { action: string; badge: string; text: string; tone: EPillTone };

/** The document most in need of action: missing required, expired, requested, then expiring within 14 days. */
export function urgentDocument(profile: PersonProfile): UrgentItem | null {
  const required = profile.requiredDocuments ?? [];
  const missing = required.find((doc) => doc.state === "MISSING");
  if (missing) return { action: `Request ${missing.label.toLowerCase()}`, badge: "Missing", text: `${missing.label} is not on file`, tone: "bad" };
  const expired = required.find((doc) => doc.state === "EXPIRED");
  if (expired) return { action: `Request ${expired.label.toLowerCase()} renewal`, badge: "Expired", text: `${expired.label} expired${expired.expiresOn ? ` ${expired.expiresOn}` : ""}`, tone: "bad" };
  const requested = profile.missingDocuments[0];
  if (requested) return { action: "Open documents", badge: "Requested", text: `${requested.title}, requested, not uploaded`, tone: "warn" };
  const expiring = required.find((doc) => doc.daysRemaining !== null && doc.daysRemaining >= 0 && doc.daysRemaining <= 14);
  if (expiring) return { action: `Request ${expiring.label.toLowerCase()} renewal`, badge: "Document", text: `${expiring.label} expires in ${expiring.daysRemaining} days`, tone: "warn" };
  return null;
}
