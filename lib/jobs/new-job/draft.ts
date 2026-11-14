/**
 * The New job page's unsaved job (board "New job", 2026-11): its shape, the
 * browser-kept draft, the request body it posts, and its checks. Plain module
 * (no "use client"): the page, its phone steps and the tests all use it.
 *
 * The body built here is the body the previous New job form posted to
 * `POST /api/admin/jobs` for the same inputs (`buildCreateBody`), so the job,
 * its rate snapshot, offer and notifications come out the same. The only new
 * request fields are the two per-job choices the page adds
 * (`skipPreferredCleaner`, `sendBookingConfirmation`), sent only when the
 * office changes them from today's behaviour.
 */
import { classifyPriorityFromTimingRule } from "@/lib/jobs/priority";
import type { JobReferenceAttachment, JobTimingPreset } from "@/lib/jobs/meta";
import { newRequestKey } from "./request-key";
import type { NewJobDuplicateSource } from "./types";

export const NEW_JOB_TYPES = [
  "AIRBNB_TURNOVER", "DEEP_CLEAN", "END_OF_LEASE", "MOVE_IN_CLEAN", "GENERAL_CLEAN", "POST_CONSTRUCTION",
  "PRESSURE_WASH", "WINDOW_CLEAN", "LAWN_MOWING", "SPECIAL_CLEAN", "COMMERCIAL_RECURRING", "CARPET_STEAM_CLEAN",
  "MOLD_TREATMENT", "UPHOLSTERY_CLEANING", "TILE_GROUT_CLEANING", "GUTTER_CLEANING", "SPRING_CLEANING",
] as const;
export type NewJobType = (typeof NEW_JOB_TYPES)[number];

/** The chips shown before "More types" (board order). */
export const FEATURED_JOB_TYPES: readonly NewJobType[] = ["AIRBNB_TURNOVER", "DEEP_CLEAN", "END_OF_LEASE", "GENERAL_CLEAN", "WINDOW_CLEAN"];

export function jobTypeLabel(type: string): string {
  const text = type.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function isNewJobType(value: unknown): value is NewJobType {
  return typeof value === "string" && (NEW_JOB_TYPES as readonly string[]).includes(value);
}

export type NewJobMode = "one" | "several" | "repeats";
export type NewJobSiteMode = "property" | "one_off";
export type NewJobStep = "property" | "job" | "when" | "who" | "review";
export const NEW_JOB_STEPS: readonly NewJobStep[] = ["property", "job", "when", "who", "review"];
export const NEW_JOB_STEP_LABELS: Record<NewJobStep, string> = { property: "Property", job: "Job", when: "When", who: "Who", review: "Review" };

export type TimingChoice = { preset: JobTimingPreset; time: string };

export type CleanerChoice =
  | { kind: "preferred" }
  | { kind: "chosen"; ids: string[]; names: string[] }
  | { kind: "unassigned" };

export type SpecialTaskDraft = { id: string; title: string; requiresPhoto: boolean };

export type SeveralDay = { dayKey: string; startTime: string; dueTime: string; endTime?: string };

export type GuestDraft = {
  guestName: string; reservationCode: string; guestPhone: string; guestEmail: string; guestProfileUrl: string;
  adults: string; children: string; infants: string; checkinAtLocal: string; checkoutAtLocal: string; locationText: string;
};

export type OneOffDraft = {
  clientId: string; siteName: string; siteAddress: string; siteSuburb: string; siteState: string; sitePostcode: string;
  bedrooms: string; bathrooms: string; hasBalcony: boolean; floorCount: string; serviceAreaSqm: string;
  siteContactName: string; siteContactPhone: string; scopeOfWork: string; accessInstructions: string;
  parkingInstructions: string; hazardNotes: string; equipmentNotes: string; keyPickupLocation: string;
};

export type RepeatsDraft = { ruleId: string; daysOfWeek: number[]; startDate: string; endDate: string };

/** One created job of this draft, remembered so a retry never repeats it. */
export type CreatedDayRecord = { dayKey: string; jobId: string; jobNumber: string | null; assigned: boolean };

export type NewJobDraft = {
  version: 1;
  /** Idempotency key of this unsaved job (several dates append the day). */
  requestKey: string;
  savedAt: string | null;
  mode: NewJobMode;
  siteMode: NewJobSiteMode;
  propertyId: string;
  jobType: NewJobType;
  dayKey: string;
  severalDays: SeveralDay[];
  pasteLines: string;
  startTime: string;
  dueTime: string;
  endTime: string;
  /** False while Start and Ready by still follow the property's defaults. */
  timesEdited: boolean;
  earlyCheckin: TimingChoice;
  lateCheckout: TimingChoice;
  /** Blank = pays clocked time. Filled from the property until edited. */
  estimatedHours: string;
  hoursEdited: boolean;
  fixedPriceOn: boolean;
  fixedPrice: string;
  invoiceNote: string;
  cleaner: CleanerChoice;
  specialTasks: SpecialTaskDraft[];
  notice: string;
  noticeImportant: boolean;
  noticeImages: string[];
  internalNote: string;
  notes: string;
  tagsText: string;
  attachments: JobReferenceAttachment[];
  guest: GuestDraft;
  oneOff: OneOffDraft;
  sendBookingConfirmation: boolean;
  repeats: RepeatsDraft;
  duplicatedFrom: { jobId: string; jobNumber: string } | null;
  created: CreatedDayRecord[];
};

export const EMPTY_GUEST: GuestDraft = {
  guestName: "", reservationCode: "", guestPhone: "", guestEmail: "", guestProfileUrl: "",
  adults: "", children: "", infants: "", checkinAtLocal: "", checkoutAtLocal: "", locationText: "",
};

export const EMPTY_ONE_OFF: OneOffDraft = {
  clientId: "", siteName: "", siteAddress: "", siteSuburb: "", siteState: "NSW", sitePostcode: "",
  bedrooms: "", bathrooms: "", hasBalcony: false, floorCount: "", serviceAreaSqm: "",
  siteContactName: "", siteContactPhone: "", scopeOfWork: "", accessInstructions: "",
  parkingInstructions: "", hazardNotes: "", equipmentNotes: "", keyPickupLocation: "",
};

export function emptyDraft(propertyId = ""): NewJobDraft {
  return {
    version: 1,
    requestKey: newRequestKey(),
    savedAt: null,
    mode: "one",
    siteMode: "property",
    propertyId,
    jobType: "AIRBNB_TURNOVER",
    dayKey: "",
    severalDays: [],
    pasteLines: "",
    startTime: "10:00",
    dueTime: "15:00",
    endTime: "",
    timesEdited: false,
    earlyCheckin: { preset: "none", time: "" },
    lateCheckout: { preset: "none", time: "" },
    estimatedHours: "",
    hoursEdited: false,
    fixedPriceOn: false,
    fixedPrice: "",
    invoiceNote: "",
    cleaner: { kind: "preferred" },
    specialTasks: [],
    notice: "",
    noticeImportant: true,
    noticeImages: [],
    internalNote: "",
    notes: "",
    tagsText: "",
    attachments: [],
    guest: { ...EMPTY_GUEST },
    oneOff: { ...EMPTY_ONE_OFF },
    sendBookingConfirmation: true,
    repeats: { ruleId: newRequestKey(), daysOfWeek: [], startDate: "", endDate: "" },
    duplicatedFrom: null,
    created: [],
  };
}

/** True once the office has entered anything worth keeping. */
export function draftHasContent(draft: NewJobDraft): boolean {
  return Boolean(
    draft.propertyId || draft.dayKey || draft.severalDays.length || draft.notice.trim() || draft.internalNote.trim() ||
      draft.notes.trim() || draft.specialTasks.length || draft.oneOff.siteName.trim() || draft.oneOff.siteAddress.trim(),
  );
}

/**
 * Choosing another property is a scope change: the date, cleaner, tasks,
 * booking details and every value filled from the old property go; the
 * notice, notes, tags and files stay (board "Coming back to an unsaved job").
 * A new request key, because it is now a different job.
 */
export function resetForPropertyChange(draft: NewJobDraft, propertyId: string): NewJobDraft {
  const fresh = emptyDraft(propertyId);
  return {
    ...fresh,
    jobType: draft.jobType,
    mode: draft.mode,
    siteMode: draft.siteMode,
    startTime: draft.startTime,
    dueTime: draft.dueTime,
    endTime: draft.endTime,
    timesEdited: draft.timesEdited,
    notice: draft.notice,
    noticeImportant: draft.noticeImportant,
    noticeImages: draft.noticeImages,
    internalNote: draft.internalNote,
    notes: draft.notes,
    tagsText: draft.tagsText,
    attachments: draft.attachments,
    sendBookingConfirmation: draft.sendBookingConfirmation,
  };
}

/** Whether a property change would throw away anything the office chose. */
export function propertyChangeLosesWork(draft: NewJobDraft): boolean {
  return Boolean(
    draft.propertyId &&
      (draft.dayKey || draft.severalDays.length || draft.cleaner.kind !== "preferred" || draft.specialTasks.length || draft.hoursEdited || draft.fixedPriceOn),
  );
}

export function parseTags(text: string): string[] {
  return text.split(",").map((value) => value.trim()).filter(Boolean);
}

export function timingApiRule(rule: TimingChoice) {
  return rule.preset === "none"
    ? { enabled: false, preset: "none" as const }
    : { enabled: true, preset: rule.preset, time: rule.preset === "custom" ? rule.time || undefined : undefined };
}

/** The concrete time a timing choice stands for, or null. */
export function timingTime(rule: TimingChoice): string | null {
  if (rule.preset === "none") return null;
  if (rule.preset === "custom") return /^\d{2}:\d{2}$/.test(rule.time) ? rule.time : null;
  return rule.preset;
}

/** Apply an early check-in / late checkout choice the way the old form did. */
export function applyTimingChoice(draft: NewJobDraft, kind: "earlyCheckin" | "lateCheckout", rule: TimingChoice): NewJobDraft {
  const next: NewJobDraft = { ...draft, [kind]: rule };
  const time = timingTime(rule);
  if (kind === "earlyCheckin" && time) next.dueTime = time;
  if (kind === "lateCheckout" && time) next.startTime = time;
  if (next.startTime && next.dueTime && next.dueTime < next.startTime) next.dueTime = next.startTime;
  return next;
}

/** Priority the server will store, from the early check-in (lib/jobs/priority). */
export function draftPriority(draft: NewJobDraft): number {
  if (draft.jobType !== "AIRBNB_TURNOVER") return 4;
  return classifyPriorityFromTimingRule(timingApiRule(draft.earlyCheckin)).priorityBucket;
}

export type CreateTarget = { dayKey: string; startTime?: string; dueTime?: string; endTime?: string };

export type CreateBody = Record<string, unknown> & {
  jobType: NewJobType;
  scheduledDate: string;
  skipPreferredCleaner?: true;
  sendBookingConfirmation?: false;
};

function trimmed(value: string): string | undefined {
  return value.trim() || undefined;
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function reservationContext(guest: GuestDraft) {
  const any = Object.values(guest).some((value) => value.trim() !== "");
  if (!any) return undefined;
  return {
    guestName: trimmed(guest.guestName),
    reservationCode: trimmed(guest.reservationCode),
    guestPhone: trimmed(guest.guestPhone),
    guestEmail: trimmed(guest.guestEmail),
    guestProfileUrl: trimmed(guest.guestProfileUrl),
    adults: numberOrUndefined(guest.adults),
    children: numberOrUndefined(guest.children),
    infants: numberOrUndefined(guest.infants),
    checkinAtLocal: guest.checkinAtLocal ? new Date(guest.checkinAtLocal).toISOString() : undefined,
    checkoutAtLocal: guest.checkoutAtLocal ? new Date(guest.checkoutAtLocal).toISOString() : undefined,
    locationText: trimmed(guest.locationText),
  };
}

function serviceContext(draft: NewJobDraft, isAirbnb: boolean) {
  const site = draft.oneOff;
  const has =
    !isAirbnb || site.scopeOfWork || site.accessInstructions || site.parkingInstructions || site.hazardNotes ||
    site.equipmentNotes || site.siteContactName || site.siteContactPhone || site.serviceAreaSqm || site.floorCount ||
    site.keyPickupLocation;
  if (!has) return undefined;
  return {
    scopeOfWork: trimmed(site.scopeOfWork),
    accessInstructions: trimmed(site.accessInstructions),
    parkingInstructions: trimmed(site.parkingInstructions),
    hazardNotes: trimmed(site.hazardNotes),
    equipmentNotes: trimmed(site.equipmentNotes),
    siteContactName: trimmed(site.siteContactName),
    siteContactPhone: trimmed(site.siteContactPhone),
    serviceAreaSqm: numberOrUndefined(site.serviceAreaSqm),
    floorCount: numberOrUndefined(site.floorCount),
    keyPickupLocation: trimmed(site.keyPickupLocation),
  };
}

/**
 * The `POST /api/admin/jobs` body for one date: the same fields, defaults
 * and normalisation the previous New job form sent. Fields the page adds
 * (special tasks, notice, fixed price, invoice note, the two choices) are
 * included only when the office used them.
 */
export function buildCreateBody(draft: NewJobDraft, target: CreateTarget, options: { asDraftJob: boolean }): CreateBody {
  const isAirbnb = draft.jobType === "AIRBNB_TURNOVER";
  const usesProperty = isAirbnb || draft.siteMode === "property";
  const site = draft.oneOff;
  const startTime = (target.startTime ?? draft.startTime) || undefined;
  const dueTime = (target.dueTime ?? draft.dueTime) || undefined;
  const body: CreateBody = {
    propertyId: usesProperty ? draft.propertyId : undefined,
    clientId: !usesProperty && site.clientId ? site.clientId : undefined,
    jobType: draft.jobType,
    scheduledDate: `${target.dayKey}T00:00:00.000Z`,
    startTime,
    dueTime,
    endTime: (target.endTime ?? draft.endTime) || undefined,
    estimatedHours: draft.estimatedHours ? Number(draft.estimatedHours) : undefined,
    notes: draft.notes || undefined,
    internalNotes: draft.internalNote || undefined,
    isDraft: options.asDraftJob,
    tags: parseTags(draft.tagsText),
    attachments: draft.attachments,
    earlyCheckin: isAirbnb ? timingApiRule(draft.earlyCheckin) : undefined,
    lateCheckout: isAirbnb ? timingApiRule(draft.lateCheckout) : undefined,
    reservationContext: isAirbnb ? reservationContext(draft.guest) : undefined,
    serviceSite: !usesProperty
      ? {
          name: site.siteName.trim(),
          address: site.siteAddress.trim(),
          suburb: site.siteSuburb.trim(),
          state: site.siteState.trim() || "NSW",
          postcode: trimmed(site.sitePostcode),
          bedrooms: numberOrUndefined(site.bedrooms),
          bathrooms: numberOrUndefined(site.bathrooms),
          hasBalcony: site.hasBalcony,
        }
      : undefined,
    serviceContext: serviceContext(draft, isAirbnb),
  };
  const tasks = draft.specialTasks.filter((task) => task.title.trim());
  if (tasks.length) {
    body.specialRequestTasks = tasks.map((task) => ({ title: task.title.trim(), requiresPhoto: task.requiresPhoto }));
  }
  if (draft.notice.trim()) {
    body.notices = [{
      body: draft.notice.trim(),
      urgency: draft.noticeImportant ? "IMPORTANT" : "INFO",
      ...(draft.noticeImages.length ? { imageUrls: draft.noticeImages.slice(0, 6) } : {}),
    }];
  }
  if (draft.fixedPriceOn && draft.fixedPrice.trim()) body.fixedPrice = Number(draft.fixedPrice);
  if (draft.invoiceNote.trim()) body.invoiceNote = draft.invoiceNote.trim();
  if (draft.cleaner.kind === "unassigned") body.skipPreferredCleaner = true;
  if (!draft.sendBookingConfirmation) body.sendBookingConfirmation = false;
  return body;
}

/** The cleaners the assign call sends after create, or null for no call. */
export function assignRequest(draft: NewJobDraft): { userIds: string[]; primaryUserId: string } | null {
  if (draft.cleaner.kind !== "chosen" || draft.cleaner.ids.length === 0) return null;
  return { userIds: draft.cleaner.ids, primaryUserId: draft.cleaner.ids[0] };
}

export type PasteLine = { dayKey: string; startTime?: string; dueTime?: string; endTime?: string };

/** The old bulk box's lines: "YYYY-MM-DD [start] [due] [end]", unchanged. */
export function parsePasteLines(text: string): { valid: PasteLine[]; invalid: string[] } {
  const lines = text.split(/\r?\n|,/).map((line) => line.trim()).filter(Boolean);
  const valid: PasteLine[] = [];
  const invalid: string[] = [];
  const normTime = (value?: string): string | undefined | null => {
    if (!value) return undefined;
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  };
  for (const line of lines) {
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length === 0 || parts.length > 4 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
      invalid.push(line);
      continue;
    }
    const start = normTime(parts[1]);
    const due = normTime(parts[2]);
    const end = normTime(parts[3]);
    if (start === null || due === null || end === null) {
      invalid.push(line);
      continue;
    }
    valid.push({ dayKey: parts[0], startTime: start, dueTime: due, endTime: end });
  }
  return { valid, invalid };
}

/** "Fri 20 Nov" for a calendar day, never shifted by the viewer's timezone. */
export function dayLabel(dayKey: string, withYear = false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return dayKey;
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  return date.toLocaleDateString("en-AU", {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}),
  });
}

export function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
}

/** The days this draft would create, in order. */
export function targetDays(draft: NewJobDraft): CreateTarget[] {
  if (draft.mode === "several") {
    return [...draft.severalDays]
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
      .map((day) => ({ dayKey: day.dayKey, startTime: day.startTime, dueTime: day.dueTime, endTime: day.endTime }));
  }
  return draft.dayKey ? [{ dayKey: draft.dayKey }] : [];
}

export type DraftProblem = { field: string; step: NewJobStep; message: string; section: "property" | "what" | "when" | "who" | "extras" };

/** The checks Create runs before sending (the server re-checks everything). */
export function validateDraft(draft: NewJobDraft, context: { asDraftJob: boolean; sameDayBlocked?: boolean } = { asDraftJob: false }): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const isAirbnb = draft.jobType === "AIRBNB_TURNOVER";
  const usesProperty = isAirbnb || draft.siteMode === "property";
  if (usesProperty && !draft.propertyId) {
    problems.push({ field: "property", step: "property", section: "property", message: isAirbnb && draft.siteMode === "one_off" ? "Airbnb turnovers need a saved property" : "Choose a property" });
  }
  if (!usesProperty) {
    const site = draft.oneOff;
    if (!site.siteName.trim()) problems.push({ field: "siteName", step: "property", section: "property", message: "Enter the site name" });
    if (!site.siteAddress.trim()) problems.push({ field: "siteAddress", step: "property", section: "property", message: "Enter the address" });
    if (!site.siteSuburb.trim()) problems.push({ field: "siteSuburb", step: "property", section: "property", message: "Enter the suburb" });
  }
  if (draft.mode === "one" && !draft.dayKey) problems.push({ field: "date", step: "when", section: "when", message: "Choose a date" });
  if (draft.mode === "several" && draft.severalDays.length === 0) problems.push({ field: "date", step: "when", section: "when", message: "Pick at least one date" });
  if (draft.mode === "repeats") {
    if (draft.repeats.daysOfWeek.length === 0) problems.push({ field: "repeatDays", step: "when", section: "when", message: "Choose the days it repeats on" });
    if (!usesProperty) problems.push({ field: "property", step: "property", section: "property", message: "A repeating job needs a saved property" });
    if (draft.repeats.startDate && draft.repeats.endDate && draft.repeats.endDate < draft.repeats.startDate) {
      problems.push({ field: "repeatEnd", step: "when", section: "when", message: "The last day is before the first" });
    }
  }
  if (draft.startTime && draft.dueTime && draft.dueTime < draft.startTime) {
    problems.push({ field: "dueTime", step: "when", section: "when", message: `Ready by ${draft.dueTime} is before the start, ${draft.startTime}` });
  }
  for (const day of draft.mode === "several" ? draft.severalDays : []) {
    if (day.startTime && day.dueTime && day.dueTime < day.startTime) {
      problems.push({ field: `day-${day.dayKey}`, step: "when", section: "when", message: `${dayLabel(day.dayKey)}: ready by is before the start` });
    }
  }
  for (const rule of [draft.earlyCheckin, draft.lateCheckout]) {
    if (isAirbnb && rule.preset === "custom" && !rule.time) {
      problems.push({ field: "timing", step: "when", section: "when", message: "Enter the custom check-in or checkout time" });
      break;
    }
  }
  if (draft.estimatedHours && !(Number(draft.estimatedHours) > 0)) {
    problems.push({ field: "hours", step: "job", section: "what", message: "Pay hours must be more than 0, or blank to pay clocked time" });
  }
  if (draft.fixedPriceOn && !(Number(draft.fixedPrice) >= 0 && draft.fixedPrice.trim())) {
    problems.push({ field: "fixedPrice", step: "job", section: "what", message: "Enter the fixed price, or switch it off" });
  }
  if (context.asDraftJob && draft.cleaner.kind === "chosen") {
    problems.push({ field: "cleaner", step: "who", section: "who", message: "A draft job cannot be assigned. Create it, or keep the suggested cleaner" });
  }
  return problems;
}

/** Copy an earlier job's copyable parts onto a fresh draft (board "Duplicate a job"). */
export function draftFromDuplicate(source: NewJobDuplicateSource): NewJobDraft {
  const draft = emptyDraft(source.propertyId);
  return {
    ...draft,
    jobType: isNewJobType(source.jobType) ? source.jobType : draft.jobType,
    startTime: source.startTime ?? draft.startTime,
    dueTime: source.dueTime ?? draft.dueTime,
    endTime: source.endTime ?? "",
    timesEdited: true,
    estimatedHours: source.estimatedHours != null ? String(source.estimatedHours) : "",
    hoursEdited: source.estimatedHours != null,
    notes: source.notes,
    internalNote: source.internalNote,
    tagsText: source.tags.join(", "),
    attachments: source.attachments,
    specialTasks: source.specialRequestTasks.map((task, index) => ({ id: `copy-${index}`, title: task.title, requiresPhoto: task.requiresPhoto === true })),
    notice: source.notices[0]?.body ?? "",
    noticeImportant: source.notices[0] ? source.notices[0].urgency === "IMPORTANT" : true,
    noticeImages: source.notices[0]?.imageUrls ?? [],
    fixedPriceOn: source.fixedPrice != null,
    fixedPrice: source.fixedPrice != null ? String(source.fixedPrice) : "",
    invoiceNote: source.invoiceNote ?? "",
    duplicatedFrom: { jobId: source.jobId, jobNumber: source.jobNumber },
  };
}

/** "Another for this property": keeps property, type and times; clears the date. */
export function draftForAnother(draft: NewJobDraft): NewJobDraft {
  const fresh = emptyDraft(draft.propertyId);
  return {
    ...fresh,
    jobType: draft.jobType,
    siteMode: draft.siteMode,
    startTime: draft.startTime,
    dueTime: draft.dueTime,
    endTime: draft.endTime,
    timesEdited: true,
    estimatedHours: draft.estimatedHours,
    hoursEdited: draft.hoursEdited,
  };
}

const STORAGE_PREFIX = "sneek:new-job-draft:v1:";

export function draftStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Read a stored draft back, or null when it is missing or not a draft of this version. */
export function parseStoredDraft(raw: string | null): NewJobDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || typeof value.requestKey !== "string") return null;
    const base = emptyDraft();
    const merged = { ...base, ...value } as NewJobDraft;
    if (!isNewJobType(merged.jobType)) merged.jobType = base.jobType;
    if (!["one", "several", "repeats"].includes(merged.mode)) merged.mode = "one";
    if (!["property", "one_off"].includes(merged.siteMode)) merged.siteMode = "property";
    merged.guest = { ...EMPTY_GUEST, ...(isRecord(value.guest) ? (value.guest as Partial<GuestDraft>) : {}) };
    merged.oneOff = { ...EMPTY_ONE_OFF, ...(isRecord(value.oneOff) ? (value.oneOff as Partial<OneOffDraft>) : {}) };
    if (!Array.isArray(merged.severalDays)) merged.severalDays = [];
    if (!Array.isArray(merged.specialTasks)) merged.specialTasks = [];
    if (!Array.isArray(merged.attachments)) merged.attachments = [];
    if (!Array.isArray(merged.noticeImages)) merged.noticeImages = [];
    if (!Array.isArray(merged.created)) merged.created = [];
    const cleaner = merged.cleaner as CleanerChoice | undefined;
    if (!cleaner || !["preferred", "chosen", "unassigned"].includes(cleaner.kind)) merged.cleaner = { kind: "preferred" };
    else if (cleaner.kind === "chosen" && (!Array.isArray(cleaner.ids) || !Array.isArray(cleaner.names))) merged.cleaner = { kind: "preferred" };
    return merged;
  } catch {
    return null;
  }
}
