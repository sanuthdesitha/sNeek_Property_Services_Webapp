/**
 * Account status, documents state and the "Needs attention" rules, derived
 * from facts the list service has already loaded. Pure: no I/O, so every rule
 * is tested on its own.
 *
 * Every rule reads real data. A person with no data for a rule simply does not
 * trip it; nothing is inferred from an absence.
 */
import type { Role } from "@prisma/client";
import { resolveCredentialStatuses, type CredentialDates } from "@/lib/workforce/credential-expiry";
import { sydneyDateKey } from "@/lib/time/sydney-range";

/** An invitation not accepted this many days after it was first sent needs chasing. */
export const INVITE_PENDING_ATTENTION_DAYS = 7;
/**
 * A staff document expiring within this many days is "expiring". The same
 * 14-day window the workforce compliance list and the document expiry sweep
 * use (lib/workforce/service.ts), so the two screens agree. Visa, licence and
 * rego dates keep their own windows from lib/workforce/credential-expiry.
 */
export const DOCUMENT_EXPIRY_WARNING_DAYS = 14;
/** Document statuses that do not count as a document on file. */
const IGNORED_DOCUMENT_STATUSES = new Set(["REJECTED"]);

export type AccountStatus = "ACTIVE" | "INVITED" | "DISABLED";

export type AccountDocumentFact = { title: string; status: string; expiresAt: Date | null };

export type AccountFacts = {
  id: string;
  role: Role;
  isActive: boolean;
  emailVerified: Date | null;
  invitation: { createdAt: Date; acceptedAt: Date | null } | null;
  documents: AccountDocumentFact[];
  /** Titles of document requests still waiting for an upload. */
  missingDocuments: string[];
  /**
   * Required document types (Settings → Required documents, for the roles this
   * person holds) with nothing on file. Absent/empty when none are required.
   */
  missingRequired?: string[];
  /** True when at least one document type is required of this person. */
  requirementsSet?: boolean;
  credentials: CredentialDates;
  /** Open job assignments scheduled today (Sydney) or later. */
  upcomingAssignments: number;
};

export type DocumentState =
  | { kind: "MISSING"; count: number; label: string }
  | { kind: "EXPIRED"; label: string }
  | { kind: "EXPIRING"; label: string; daysRemaining: number }
  | { kind: "OK"; label: string }
  | { kind: "NONE"; label: string };

export type AttentionReason = "INVITE_PENDING" | "DOCUMENTS" | "DISABLED_ASSIGNED" | "EMAIL_UNVERIFIED";

export const ATTENTION_LABEL: Record<AttentionReason, string> = {
  INVITE_PENDING: `Invite not accepted after ${INVITE_PENDING_ATTENTION_DAYS} days`,
  DOCUMENTS: "Documents missing, expired or expiring",
  DISABLED_ASSIGNED: "Disabled but still assigned to upcoming jobs",
  EMAIL_UNVERIFIED: "Email address not verified",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function sydneyDaysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${sydneyDateKey(from)}T00:00:00Z`);
  const b = Date.parse(`${sydneyDateKey(to)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

export function accountStatus(facts: Pick<AccountFacts, "isActive" | "invitation">): AccountStatus {
  if (!facts.isActive) return "DISABLED";
  if (facts.invitation && !facts.invitation.acceptedAt) return "INVITED";
  return "ACTIVE";
}

/** Whole Sydney days since the (first) invitation, or null when not invited. */
export function inviteAgeDays(facts: Pick<AccountFacts, "invitation">, now: Date): number | null {
  if (!facts.invitation || facts.invitation.acceptedAt) return null;
  return Math.max(0, sydneyDaysBetween(facts.invitation.createdAt, now));
}

type Expiry = { label: string; daysRemaining: number };

function expiries(facts: Pick<AccountFacts, "documents" | "credentials">, now: Date): { expired: Expiry[]; expiring: Expiry[]; onFile: number } {
  const expired: Expiry[] = [];
  const expiring: Expiry[] = [];
  let onFile = 0;
  for (const doc of facts.documents) {
    if (IGNORED_DOCUMENT_STATUSES.has(doc.status)) continue;
    onFile += 1;
    if (!doc.expiresAt) continue;
    const days = sydneyDaysBetween(now, doc.expiresAt);
    if (days < 0) expired.push({ label: doc.title, daysRemaining: days });
    else if (days <= DOCUMENT_EXPIRY_WARNING_DAYS) expiring.push({ label: doc.title, daysRemaining: days });
  }
  for (const credential of resolveCredentialStatuses(facts.credentials, now)) {
    onFile += 1;
    if (credential.state === "EXPIRED") expired.push({ label: credential.label, daysRemaining: credential.daysRemaining });
    else if (credential.state === "EXPIRING_SOON") expiring.push({ label: credential.label, daysRemaining: credential.daysRemaining });
  }
  expired.sort((a, b) => a.daysRemaining - b.daysRemaining);
  expiring.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return { expired, expiring, onFile };
}

/** The single most urgent documents fact, as the Documents column shows it. */
export function documentState(facts: Pick<AccountFacts, "documents" | "missingDocuments" | "credentials" | "missingRequired" | "requirementsSet">, now: Date): DocumentState {
  const missingRequired = facts.missingRequired ?? [];
  if (facts.missingDocuments.length > 0 || missingRequired.length > 0) {
    const count = facts.missingDocuments.length + missingRequired.length;
    return { kind: "MISSING", count, label: `${count} missing` };
  }
  const { expired, expiring, onFile } = expiries(facts, now);
  if (expired.length > 0) return { kind: "EXPIRED", label: `${expired[0].label} expired` };
  if (expiring.length > 0) {
    const first = expiring[0];
    return { kind: "EXPIRING", label: `${first.label}, ${first.daysRemaining} d`, daysRemaining: first.daysRemaining };
  }
  // "Complete" only when requirements are set and every one is on file;
  // otherwise nothing is known to be complete, only that nothing is overdue.
  if (facts.requirementsSet) return { kind: "OK", label: "Complete" };
  if (onFile > 0) return { kind: "OK", label: "Up to date" };
  return { kind: "NONE", label: "None on file" };
}

export function documentsNeedAttention(state: Pick<DocumentState, "kind">): boolean {
  return state.kind === "MISSING" || state.kind === "EXPIRED" || state.kind === "EXPIRING";
}

/** Every Needs attention rule this person trips, in a stable order. */
export function attentionReasons(facts: AccountFacts, now: Date): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const status = accountStatus(facts);
  const age = inviteAgeDays(facts, now);
  if (status === "INVITED" && age !== null && age > INVITE_PENDING_ATTENTION_DAYS) reasons.push("INVITE_PENDING");
  if (documentsNeedAttention(documentState(facts, now))) reasons.push("DOCUMENTS");
  if (status === "DISABLED" && facts.upcomingAssignments > 0) reasons.push("DISABLED_ASSIGNED");
  // An invited person has not verified yet by definition; that is the invite rule's job.
  if (status === "ACTIVE" && !facts.emailVerified) reasons.push("EMAIL_UNVERIFIED");
  return reasons;
}
