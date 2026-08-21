/**
 * CREDENTIALS THAT LAPSE — visa, driver licence, vehicle rego.
 *
 * These are dates on the User row rather than uploaded files, so the document
 * expiry sweep never saw them. `vehicleRegoExpiry` and `driverLicenseExpiry`
 * have existed for a long time and **nothing has ever read them**: no job, no
 * reminder, no screen. A licence could lapse silently and the first anyone knew
 * was a roadside fine. `visaExpiry` is new and joins them here rather than
 * getting a sweep of its own, because three dates with three sweeps is how two
 * of them end up wrong.
 *
 * A right-to-work date is the sharpest of the three: rostering someone whose
 * visa has expired is not an administrative slip, it is work they are not
 * permitted to do. So it gets the longest warning.
 *
 * PURE — no DB, no I/O.
 */

import { sydneyDateKey } from "@/lib/time/sydney-range";

export type CredentialKind = "VISA" | "DRIVER_LICENCE" | "VEHICLE_REGO";

/**
 * How far ahead each one is worth chasing.
 *
 * A visa is 60 days because renewing one is not a same-week errand — it can
 * mean an application, a decision and a wait, and a fortnight's notice is not
 * actionable. A licence or rego renewal is a form and a payment, so the
 * document sweep's 14 days would do; 30 gives a reminder cycle of slack
 * without becoming background noise.
 */
export const CREDENTIAL_WARNING_DAYS: Record<CredentialKind, number> = {
  VISA: 60,
  DRIVER_LICENCE: 30,
  VEHICLE_REGO: 30,
};

export const CREDENTIAL_LABEL: Record<CredentialKind, string> = {
  VISA: "Visa / right to work",
  DRIVER_LICENCE: "Driver licence",
  VEHICLE_REGO: "Vehicle registration",
};

export type CredentialState = "OK" | "EXPIRING_SOON" | "EXPIRED";

export interface CredentialStatus {
  kind: CredentialKind;
  label: string;
  expiresAt: Date;
  state: CredentialState;
  /** Whole days until it lapses. Negative once it has. */
  daysRemaining: number;
}

export interface CredentialDates {
  visaExpiry?: Date | null;
  driverLicenseExpiry?: Date | null;
  vehicleRegoExpiry?: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days between two instants, counted in whole SYDNEY days.
 *
 * Compared by calendar day rather than elapsed hours: a licence expiring
 * "today" should read as 0 days left all day, not flip to -1 at some hour of
 * the afternoon because the stored time was midnight UTC.
 */
function daysUntil(expiresAt: Date, now: Date): number {
  const a = Date.parse(`${sydneyDateKey(now)}T00:00:00Z`);
  const b = Date.parse(`${sydneyDateKey(expiresAt)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

function statusFor(
  kind: CredentialKind,
  expiresAt: Date | null | undefined,
  now: Date
): CredentialStatus | null {
  if (!expiresAt) return null;
  const time = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return null;

  const date = new Date(time);
  const daysRemaining = daysUntil(date, now);
  const state: CredentialState =
    daysRemaining < 0
      ? "EXPIRED"
      : daysRemaining <= CREDENTIAL_WARNING_DAYS[kind]
        ? "EXPIRING_SOON"
        : "OK";

  return { kind, label: CREDENTIAL_LABEL[kind], expiresAt: date, state, daysRemaining };
}

/**
 * Every credential this person has a date for, in the order they should be
 * dealt with: soonest to lapse first, because that is the order someone
 * chasing them would work through.
 */
export function resolveCredentialStatuses(
  dates: CredentialDates,
  now: Date = new Date()
): CredentialStatus[] {
  return [
    statusFor("VISA", dates.visaExpiry, now),
    statusFor("DRIVER_LICENCE", dates.driverLicenseExpiry, now),
    statusFor("VEHICLE_REGO", dates.vehicleRegoExpiry, now),
  ]
    .filter((status): status is CredentialStatus => status !== null)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/** The ones worth telling an admin about right now. */
export function credentialsNeedingAttention(
  dates: CredentialDates,
  now: Date = new Date()
): CredentialStatus[] {
  return resolveCredentialStatuses(dates, now).filter((status) => status.state !== "OK");
}

/**
 * One line an admin can act on without opening anything.
 *
 * Names the person, the credential and the timing — a subject reading only
 * "credential expiring" makes every recipient open it to find out whether it
 * concerns them.
 */
export function describeCredential(status: CredentialStatus, personName: string): string {
  if (status.state === "EXPIRED") {
    const days = Math.abs(status.daysRemaining);
    return `${personName} — ${status.label} EXPIRED ${
      days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`
    }`;
  }
  if (status.daysRemaining === 0) return `${personName} — ${status.label} expires TODAY`;
  return `${personName} — ${status.label} expires in ${status.daysRemaining} day${
    status.daysRemaining === 1 ? "" : "s"
  }`;
}
