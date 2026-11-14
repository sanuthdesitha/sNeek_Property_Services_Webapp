/**
 * Workforce › Compliance action list (board "Workforce", 2026-11-16): every
 * row that needs someone to act, sorted by urgency, built only from existing
 * records:
 *   - documents: expired or expiring (the one that runs latest for a person
 *     and category decides, so a renewed check hides the old one), and
 *     uploads waiting for review;
 *   - outstanding document requests (overdue first);
 *   - licence, visa and rego dates from the person's profile (the expiry
 *     sweep already reads them; lib/workforce/credential-expiry.ts).
 * A missing date is never turned into "expired" or "current".
 *
 * PURE: no DB, no I/O. Plain module, safe for server pages and clients.
 */
import { CREDENTIAL_LABEL, CREDENTIAL_WARNING_DAYS, type CredentialKind } from "./credential-expiry";

export const DOCUMENT_EXPIRY_WARNING_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ComplianceRowState = "EXPIRED" | "OVERDUE_REQUEST" | "EXPIRING" | "WAITING_REVIEW" | "REQUESTED";

export type ComplianceTone = "problem" | "attention" | "info" | null;

export type LastChased = { at: string; transports: string[]; failedTransports: string[] };

export type ComplianceActionRow = {
  key: string;
  kind: "document" | "request" | "profile_date";
  state: ComplianceRowState;
  personId: string;
  personName: string;
  title: string;
  category: string;
  /** The date the row is about: expiry, due date or upload time (ISO). */
  dateIso: string | null;
  /** Whole days from today to `dateIso` (negative when past); null without a date. */
  days: number | null;
  documentId: string | null;
  requestId: string | null;
  credentialKind: CredentialKind | null;
  uploadedAt: string | null;
  verifiedByName: string | null;
  requestedByName: string | null;
  requiresSignature: boolean;
  lastChased: LastChased | null;
};

export type ComplianceDocumentInput = {
  id: string;
  title: string;
  category: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  requiresSignature: boolean;
  userId: string;
  userName: string;
  verifiedByName: string | null;
};

export type ComplianceRequestInput = {
  id: string;
  title: string;
  category: string;
  dueAt: string | null;
  createdAt: string;
  userId: string;
  userName: string;
  requestedByName: string | null;
};

export type ComplianceProfileInput = {
  userId: string;
  userName: string;
  visaExpiry: string | null;
  driverLicenseExpiry: string | null;
  vehicleRegoExpiry: string | null;
};

const STATE_ORDER: Record<ComplianceRowState, number> = {
  EXPIRED: 0,
  OVERDUE_REQUEST: 1,
  EXPIRING: 2,
  WAITING_REVIEW: 3,
  REQUESTED: 4,
};

export function toneForState(state: ComplianceRowState): ComplianceTone {
  if (state === "EXPIRED") return "problem";
  if (state === "EXPIRING" || state === "OVERDUE_REQUEST") return "attention";
  if (state === "WAITING_REVIEW") return "info";
  return null;
}

export const STATE_LABEL: Record<ComplianceRowState, string> = {
  EXPIRED: "Expired",
  OVERDUE_REQUEST: "Requested, past due",
  EXPIRING: "Expiring",
  WAITING_REVIEW: "Waiting for review",
  REQUESTED: "Requested",
};

/** Whole days between today and a date, by UTC calendar day (dates are stored as days). */
export function daysFromToday(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const today = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const day = Date.parse(new Date(time).toISOString().slice(0, 10) + "T00:00:00Z");
  return Math.round((day - today) / DAY_MS);
}

function baseRow(partial: Partial<ComplianceActionRow> & Pick<ComplianceActionRow, "key" | "kind" | "state" | "personId" | "personName" | "title" | "category">): ComplianceActionRow {
  return {
    dateIso: null,
    days: null,
    documentId: null,
    requestId: null,
    credentialKind: null,
    uploadedAt: null,
    verifiedByName: null,
    requestedByName: null,
    requiresSignature: false,
    lastChased: null,
    ...partial,
  };
}

export function buildComplianceRows(
  input: {
    documents: readonly ComplianceDocumentInput[];
    requests: readonly ComplianceRequestInput[];
    profiles: readonly ComplianceProfileInput[];
    lastChased?: ReadonlyMap<string, LastChased>;
  },
  now: Date = new Date(),
): ComplianceActionRow[] {
  const rows: ComplianceActionRow[] = [];

  // The document that runs latest decides each person's category.
  const deciding = new Map<string, ComplianceDocumentInput>();
  for (const document of input.documents) {
    if (document.status.toUpperCase() === "REJECTED" || !document.expiresAt) continue;
    const key = `${document.userId}:${document.category.toUpperCase()}`;
    const current = deciding.get(key);
    if (!current || Date.parse(document.expiresAt) > Date.parse(current.expiresAt!)) deciding.set(key, document);
  }
  const undatedCurrent = new Set(
    input.documents
      .filter((document) => !document.expiresAt && ["VERIFIED", "SIGNED"].includes(document.status.toUpperCase()))
      .map((document) => `${document.userId}:${document.category.toUpperCase()}`),
  );

  for (const document of input.documents) {
    const status = document.status.toUpperCase();
    const common = {
      personId: document.userId,
      personName: document.userName,
      title: document.title,
      category: document.category,
      documentId: document.id,
      uploadedAt: document.createdAt,
      verifiedByName: document.verifiedByName,
      requiresSignature: document.requiresSignature,
      lastChased: input.lastChased?.get(document.id) ?? null,
    };
    if (status === "PENDING") {
      rows.push(baseRow({ ...common, key: `review:${document.id}`, kind: "document", state: "WAITING_REVIEW", dateIso: document.expiresAt, days: daysFromToday(document.expiresAt, now) }));
      continue;
    }
    const groupKey = `${document.userId}:${document.category.toUpperCase()}`;
    if (deciding.get(groupKey)?.id !== document.id || undatedCurrent.has(groupKey)) continue;
    const days = daysFromToday(document.expiresAt, now);
    if (days === null) continue;
    const state: ComplianceRowState | null = status === "EXPIRED" || days < 0 ? "EXPIRED" : days <= DOCUMENT_EXPIRY_WARNING_DAYS ? "EXPIRING" : null;
    if (state) rows.push(baseRow({ ...common, key: `expiry:${document.id}`, kind: "document", state, dateIso: document.expiresAt, days }));
  }

  for (const request of input.requests) {
    const days = daysFromToday(request.dueAt, now);
    rows.push(
      baseRow({
        key: `request:${request.id}`,
        kind: "request",
        state: days !== null && days < 0 ? "OVERDUE_REQUEST" : "REQUESTED",
        personId: request.userId,
        personName: request.userName,
        title: request.title,
        category: request.category,
        requestId: request.id,
        dateIso: request.dueAt,
        days,
        uploadedAt: request.createdAt,
        requestedByName: request.requestedByName,
      }),
    );
  }

  for (const profile of input.profiles) {
    const dates: Array<[CredentialKind, string | null]> = [
      ["VISA", profile.visaExpiry],
      ["DRIVER_LICENCE", profile.driverLicenseExpiry],
      ["VEHICLE_REGO", profile.vehicleRegoExpiry],
    ];
    for (const [kind, iso] of dates) {
      const days = daysFromToday(iso, now);
      if (days === null) continue;
      const state: ComplianceRowState | null = days < 0 ? "EXPIRED" : days <= CREDENTIAL_WARNING_DAYS[kind] ? "EXPIRING" : null;
      if (!state) continue;
      rows.push(
        baseRow({
          key: `profile:${profile.userId}:${kind}`,
          kind: "profile_date",
          state,
          personId: profile.userId,
          personName: profile.userName,
          title: CREDENTIAL_LABEL[kind],
          category: kind,
          credentialKind: kind,
          dateIso: iso,
          days,
        }),
      );
    }
  }

  return sortComplianceRows(rows);
}

/** Most urgent first: expired (longest overdue), overdue requests, expiring (soonest), reviews (oldest), requests (due soonest). */
export function sortComplianceRows(rows: ComplianceActionRow[]): ComplianceActionRow[] {
  return rows.slice().sort((a, b) => {
    const order = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (order !== 0) return order;
    if (a.state === "WAITING_REVIEW") return (a.uploadedAt ?? "").localeCompare(b.uploadedAt ?? "");
    const ad = a.days ?? Number.POSITIVE_INFINITY;
    const bd = b.days ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.personName.localeCompare(b.personName);
  });
}

export type ComplianceFigures = {
  needsAction: number;
  expired: number;
  expiring: number;
  waitingReview: number;
  requested: number;
  requestedPastDue: number;
};

export function complianceFigures(rows: readonly ComplianceActionRow[]): ComplianceFigures {
  const count = (state: ComplianceRowState) => rows.filter((row) => row.state === state).length;
  return {
    needsAction: rows.length,
    expired: count("EXPIRED"),
    expiring: count("EXPIRING"),
    waitingReview: count("WAITING_REVIEW"),
    requested: count("REQUESTED") + count("OVERDUE_REQUEST"),
    requestedPastDue: count("OVERDUE_REQUEST"),
  };
}

/** Review order for "Next to review": the waiting rows in list order. */
export function nextToReview(rows: readonly ComplianceActionRow[], currentDocumentId: string | null): ComplianceActionRow | null {
  const waiting = rows.filter((row) => row.state === "WAITING_REVIEW" && row.documentId);
  if (waiting.length === 0) return null;
  const index = waiting.findIndex((row) => row.documentId === currentDocumentId);
  if (index === -1) return waiting[0];
  return waiting[index + 1] ?? null;
}
