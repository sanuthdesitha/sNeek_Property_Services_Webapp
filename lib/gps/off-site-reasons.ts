/**
 * Why someone started a job — or ran an inspection — away from the property.
 *
 * CODED, not free text. The existing `gpsCheckInNote` field already accepts
 * prose, and prose cannot be counted: "couldn't get signal", "no gps", "phone
 * wouldn't locate me" and "GPS not working" are one operational fact written
 * four ways. A code makes "how often does this happen, and where?" answerable,
 * which is the entire point of asking.
 *
 * The note stays alongside the code — the code is for counting, the note for
 * the specifics that make an individual case understandable.
 *
 * Modelled on the laundry-skip reason pattern (LAUNDRY_SKIP_REASONS in the
 * cleaner job workspace), which is the best analysable-reason precedent in the
 * codebase.
 */

export interface OffSiteReason {
  code: string;
  label: string;
  /** Whether this reason means the person genuinely IS at the property. */
  claimsOnSite: boolean;
}

export const OFF_SITE_REASON_CODES: OffSiteReason[] = [
  {
    code: "POOR_SIGNAL",
    label: "I'm at the property — my phone can't get an accurate location",
    claimsOnSite: true,
  },
  {
    code: "UNDERGROUND_PARKING",
    label: "I'm in the building's carpark or basement",
    claimsOnSite: true,
  },
  {
    code: "LARGE_COMPLEX",
    label: "Large complex — the pin is set to a different part of the site",
    claimsOnSite: true,
  },
  {
    code: "WRONG_PIN",
    label: "The property's pin looks wrong",
    claimsOnSite: true,
  },
  {
    code: "KEY_PICKUP",
    label: "Collecting keys or supplies first",
    claimsOnSite: false,
  },
  {
    code: "STARTED_EARLY_ELSEWHERE",
    label: "Doing prep before I get there",
    claimsOnSite: false,
  },
  {
    code: "ON_THE_WAY",
    label: "Still travelling — starting the clock early",
    claimsOnSite: false,
  },
  {
    code: "OTHER",
    label: "Something else (explain below)",
    claimsOnSite: false,
  },
];

const BY_CODE = new Map(OFF_SITE_REASON_CODES.map((r) => [r.code, r]));

export function isValidOffSiteReason(code: unknown): code is string {
  return typeof code === "string" && BY_CODE.has(code);
}

export function offSiteReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return BY_CODE.get(code)?.label ?? code;
}

/**
 * Does this reason claim the person is actually at the property?
 *
 * Drives how the start is presented to admins: a signal problem is a data
 * quality issue, whereas "still travelling" is a genuine off-site start and
 * should read as one.
 */
export function reasonClaimsOnSite(code: string | null | undefined): boolean {
  if (!code) return false;
  return BY_CODE.get(code)?.claimsOnSite ?? false;
}

/** Free-text notes must actually say something. */
export const OFF_SITE_NOTE_MIN_LENGTH = 5;
