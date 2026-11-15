/**
 * Readiness: the approval check shown as a checklist before Activate.
 *
 * Required (owner defaults 2026-11-16, pending owner confirmation): a client,
 * name and address, at least one job type, access, and a client rate for the
 * main job type (the first ticked one). Everything else is recommended and
 * never blocks. A recommended section the office skipped counts as resolved.
 * A code the client typed must be reviewed by the office before activation.
 *
 * Plain module: the list, the workspace, the activate route and the tests all
 * compute readiness here, from the same snapshot.
 */
import type { AccessEntryView, OnboardingRate } from "./types";
import { ONBOARDING_SECTIONS, type OnboardingSectionKey } from "./sections";

export type ReadinessSnapshot = {
  clientLabel: string | null;
  propertyName: string | null;
  address: string | null;
  suburb: string | null;
  hasPin: boolean;
  jobTypes: string[];
  access: AccessEntryView[];
  /** Access rows saved by the earlier wizard (they still reach the property). */
  legacyAccessCount: number;
  rates: OnboardingRate[];
  bedrooms: number | null;
  bathrooms: number | null;
  roomCount: number;
  laundryEnabled: boolean | null;
  laundryPartnerName: string | null;
  stockRowCount: number;
  /** The checklist step was reviewed and saved (adminOverrides.checklist). */
  checklistReviewed: boolean;
  photoTotal: number;
  photoDone: number;
  hasCalendarLink: boolean;
  houseRulesFilled: boolean;
  skipped: string[];
};

export type ReadinessItemState = "done" | "missing" | "skipped";

export type ReadinessItem = {
  key: string;
  section: OnboardingSectionKey;
  required: boolean;
  label: string;
  state: ReadinessItemState;
  /** What is there, or exactly what is missing. */
  detail: string;
};

export type ReadinessSummary = {
  items: ReadinessItem[];
  requiredDone: number;
  requiredTotal: number;
  recommendedDone: number;
  recommendedTotal: number;
  percent: number;
  ready: boolean;
  /** The first missing required item, else the first open recommended one, else null. */
  next: ReadinessItem | null;
  missingRequired: ReadinessItem[];
};

export function jobTypeLabel(jobType: string): string {
  const text = jobType.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function mainJobType(jobTypes: readonly string[]): string | null {
  return jobTypes.length > 0 ? jobTypes[0] : null;
}

function rateFor(rates: readonly OnboardingRate[], jobType: string): OnboardingRate | undefined {
  return rates.find((rate) => rate.jobType === jobType);
}

export function hasUsableRate(rate: OnboardingRate | undefined): boolean {
  return Boolean(rate && typeof rate.clientRate === "number" && Number.isFinite(rate.clientRate) && rate.clientRate > 0);
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function item(section: OnboardingSectionKey, required: boolean, label: string, done: boolean, detail: string, skipped: readonly string[]): ReadinessItem {
  const state: ReadinessItemState = done ? "done" : !required && skipped.includes(section) ? "skipped" : "missing";
  return { key: `${section}:${label}`, section, required, label, state, detail };
}

function accessDetail(snapshot: ReadinessSnapshot): { done: boolean; detail: string } {
  const pending = snapshot.access.filter((entry) => entry.codeNeedsReview).length;
  const usable = snapshot.access.filter((entry) => entry.where.trim() || entry.hasCode || entry.photos.length > 0).length + snapshot.legacyAccessCount;
  if (usable === 0) return { done: false, detail: "No lockbox, key or entry details yet" };
  if (pending > 0) return { done: false, detail: `${pending} code${pending === 1 ? "" : "s"} from the client to review` };
  const kinds = Array.from(new Set(snapshot.access.map((entry) => entry.kind.toLowerCase())));
  return { done: true, detail: kinds.length ? kinds.join(", ") : `${usable} detail${usable === 1 ? "" : "s"} from the earlier wizard` };
}

export function computeReadiness(snapshot: ReadinessSnapshot): ReadinessSummary {
  const skipped = snapshot.skipped;
  const access = accessDetail(snapshot);
  const main = mainJobType(snapshot.jobTypes);
  const mainRate = main ? rateFor(snapshot.rates, main) : undefined;
  const allRated = snapshot.jobTypes.length > 0 && snapshot.jobTypes.every((jobType) => hasUsableRate(rateFor(snapshot.rates, jobType)));
  const basicsDone = Boolean(snapshot.propertyName?.trim() && snapshot.address?.trim() && snapshot.suburb?.trim());
  const basicsMissing = [!snapshot.propertyName?.trim() && "name", !snapshot.address?.trim() && "address", !snapshot.suburb?.trim() && "suburb"].filter(Boolean).join(", ");

  const items: ReadinessItem[] = [
    item("client", true, "Client", Boolean(snapshot.clientLabel), snapshot.clientLabel ?? "No client linked", skipped),
    item("basics", true, "Name and address", basicsDone, basicsDone ? (snapshot.hasPin ? "Pin set" : "No pin yet; the address is looked up on activation") : `Missing ${basicsMissing}`, skipped),
    item("scope", true, "Job types", snapshot.jobTypes.length > 0, snapshot.jobTypes.length ? snapshot.jobTypes.map(jobTypeLabel).join(", ") : "No job type ticked", skipped),
    item("access", true, "Access", access.done, access.detail, skipped),
    item(
      "pricing",
      true,
      main ? `Rate for ${jobTypeLabel(main)}` : "Rate for the main job type",
      hasUsableRate(mainRate),
      hasUsableRate(mainRate) ? money(mainRate!.clientRate!) : main ? "No rate yet" : "Tick a job type first",
      skipped,
    ),
    item("rooms", false, "Rooms and beds", snapshot.roomCount > 0, snapshot.roomCount > 0 ? `${snapshot.bedrooms ?? "?"} bed, ${snapshot.bathrooms ?? "?"} bath, ${snapshot.roomCount} rooms listed` : "No rooms listed", skipped),
    item("laundry", false, "Linen and laundry", snapshot.laundryEnabled !== null, snapshot.laundryEnabled === null ? "Not answered" : snapshot.laundryEnabled ? snapshot.laundryPartnerName ?? "On, no partner chosen" : "No laundry service", skipped),
    item("stock", false, "Stock list", snapshot.stockRowCount > 0, snapshot.stockRowCount > 0 ? `${snapshot.stockRowCount} items` : "No stock list", skipped),
    item("scope", false, "Checklist reviewed", snapshot.checklistReviewed, snapshot.checklistReviewed ? "Saved for this property" : "Library defaults; not reviewed yet", skipped),
    item("photos", false, "Photos per room", snapshot.photoTotal > 0 && snapshot.photoDone === snapshot.photoTotal, snapshot.photoTotal ? `${snapshot.photoDone} of ${snapshot.photoTotal} rooms` : "No reference photos", skipped),
    item("pricing", false, "Rates for every job type", allRated, allRated ? "Every ticked type has a rate" : "Some ticked types have no rate", skipped),
    item("calendar", false, "Calendar link", snapshot.hasCalendarLink, snapshot.hasCalendarLink ? "Linked" : "No calendar link", skipped),
    item("rules", false, "House rules and hazards", snapshot.houseRulesFilled, snapshot.houseRulesFilled ? "Filled" : "Not filled", skipped),
  ];

  const required = items.filter((entry) => entry.required);
  const recommended = items.filter((entry) => !entry.required);
  const requiredDone = required.filter((entry) => entry.state === "done").length;
  const recommendedDone = recommended.filter((entry) => entry.state !== "missing").length;
  // Required items weigh twice as much as recommended ones.
  const percent = Math.round(((requiredDone * 2 + recommendedDone) / (required.length * 2 + recommended.length)) * 100);
  const missingRequired = required.filter((entry) => entry.state !== "done");
  const order = (entry: ReadinessItem) => ONBOARDING_SECTIONS.findIndex((section) => section.key === entry.section);
  const next =
    [...missingRequired].sort((a, b) => order(a) - order(b))[0] ??
    [...recommended.filter((entry) => entry.state === "missing")].sort((a, b) => order(a) - order(b))[0] ??
    null;
  return {
    items,
    requiredDone,
    requiredTotal: required.length,
    recommendedDone,
    recommendedTotal: recommended.length,
    percent,
    ready: missingRequired.length === 0,
    next,
    missingRequired,
  };
}

export type SectionMark = "done" | "required" | "recommended" | "client";

/** The checklist mark for one section: any missing required item wins, then a client ask, then recommended. */
export function sectionMark(summary: ReadinessSummary, section: OnboardingSectionKey, askedOfClient: boolean): SectionMark {
  const entries = summary.items.filter((entry) => entry.section === section);
  if (entries.some((entry) => entry.required && entry.state !== "done")) return "required";
  if (entries.length > 0 && entries.every((entry) => entry.state === "done")) return "done";
  if (askedOfClient) return "client";
  if (entries.length === 0) return "done";
  return entries.every((entry) => entry.state !== "missing") ? "done" : "recommended";
}
