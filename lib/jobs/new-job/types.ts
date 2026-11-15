/**
 * Shapes the New job page reads from its read-only preview endpoints
 * (`/api/admin/jobs/new-job/*`). Plain module: the server loaders, the
 * client page and tests import it. Never add "use client" here.
 *
 * Every value that can be missing is `null` with a reason, never 0: a rate,
 * duration, booking or provider that is not set is shown as "not set".
 */
import type { ClientChargeSource } from "@/lib/finance/job-money";
import type { CleanerSuggestion } from "@/lib/jobs/cleaner-suggestions";

export type NewJobPropertyOption = {
  id: string;
  name: string;
  address: string;
  suburb: string;
  clientName: string | null;
  isActive: boolean;
  /** A service site made for an earlier one-off job. */
  isOneOff: boolean;
  /** yyyy-MM-dd of the latest job at the property, when there is one. */
  lastJobDayKey: string | null;
};

export type NewJobOptions = {
  properties: NewJobPropertyOption[];
  /** Properties of the most recently created jobs, newest first (at most 3). */
  recentPropertyIds: string[];
  /** Whether recurring generation is switched on (Repeats says so). */
  recurring: { enabled: boolean; lookaheadDays: number };
};

export type NewJobClientPrice = {
  amount: number | null;
  source: ClientChargeSource;
  /** True when nothing would price the job: shown as "not set". */
  missing: boolean;
};

export type NewJobCleanerPay = {
  /** Per-clean rate the assignment would snapshot, or null when none is set. */
  rate: number | null;
  basis: "preferred_cleaner_rate" | "property_rate" | "none";
};

export type NewJobIcal = {
  enabled: boolean;
  provider: string;
  lastSyncAt: string | null;
  status: string;
  error: string | null;
};

export type NewJobPropertyFacts = {
  property: {
    id: string;
    name: string;
    address: string;
    suburb: string;
    isActive: boolean;
    imageUrl: string | null;
    bedrooms: number;
    bathrooms: number;
    sofaBedCount: number;
    hasBalcony: boolean;
    laundryEnabled: boolean;
    inventoryEnabled: boolean;
    defaultCheckinTime: string;
    defaultCheckoutTime: string;
    keyLostMode: boolean;
  };
  client: { id: string; name: string } | null;
  laundry: { partnerNames: string[]; bagLabel: string | null; bagColor: string | null };
  ical: NewJobIcal | null;
  preferredCleaner: { id: string; name: string; active: boolean } | null;
  /** Pay hours from the property's clean length (lib/properties/clean-hours). */
  hours: number | null;
  clientPrice: NewJobClientPrice;
  cleanerPay: NewJobCleanerPay;
  form: { name: string; version: number; source: "property_override" | "global_latest" } | null;
  access: { hasGuide: boolean; guideEntries: number; guidePhotos: number; keyLocation: string | null };
  /** Open carry-forward tasks waiting for the property's next job. */
  carryForward: { count: number; titles: string[] };
  /** Special tasks used on recent jobs here, offered as one-tap suggestions. */
  recentTaskTitles: string[];
};

export type NewJobBooking = {
  guestName: string | null;
  reservationCode: string | null;
  /** HH:mm in the organisation timezone, when the feed gave a time. */
  time: string | null;
  adults: number | null;
  children: number | null;
  nights: number | null;
};

export type NewJobSameDayJob = {
  jobId: string;
  jobNumber: string;
  jobType: string;
  startTime: string | null;
  status: string;
  fromCalendar: boolean;
  cleaners: string[];
  accepted: boolean;
};

export type NewJobLaundryPreview =
  | { kind: "not_applicable"; reason: string }
  | { kind: "unavailable"; reason: string }
  | {
      kind: "preview";
      rulesVersion: number;
      pickupDate: string;
      dropoffDate: string;
      pickupTime: string | null;
      dropoffTime: string | null;
      scenario: string;
      flagged: boolean;
      flagReason: string | null;
      note: string | null;
      nextCleanDayKey: string | null;
    };

export type NewJobDay = {
  dayKey: string;
  /** The departing guest on this day (reservation ending here). */
  guestOut: NewJobBooking | null;
  /** The arriving guest on this day (reservation starting here). */
  guestIn: NewJobBooking | null;
  /** Hours between guest out and guest in, when both times are known. */
  windowHours: number | null;
  sameDayJobs: NewJobSameDayJob[];
  laundry: NewJobLaundryPreview;
  /** Whether the carry-forward tasks would attach to a job on this day. */
  carryForwardAttaches: "yes" | "no" | "not_applicable";
};

export type NewJobBookingEmail = {
  applies: boolean;
  automationOn: boolean;
  clientOptedOut: boolean;
  providerConfigured: boolean;
  recipients: string[];
  subject: string | null;
  bodyText: string | null;
  /** Why it would not be sent today, in words. Null when it would be sent. */
  blockedReason: string | null;
};

export type NewJobDayCheck = {
  days: NewJobDay[];
  suggestions:
    | { kind: "ok"; dayKey: string; items: CleanerSuggestion[]; considered: number }
    | { kind: "not_requested" };
  bookingEmail: NewJobBookingEmail | null;
};

/** The parts of an earlier job "Duplicate a job" copies (board "New job"). */
export type NewJobDuplicateSource = {
  jobId: string;
  jobNumber: string;
  propertyId: string;
  propertyName: string;
  jobType: string;
  dayKey: string;
  status: string;
  cleaners: string[];
  startTime: string | null;
  dueTime: string | null;
  endTime: string | null;
  estimatedHours: number | null;
  notes: string;
  internalNote: string;
  tags: string[];
  attachments: Array<{ key: string; url: string; name: string; mimeType?: string; sizeBytes?: number }>;
  specialRequestTasks: Array<{ title: string; description?: string; requiresPhoto?: boolean; requiresNote?: boolean; allowNotApplicable?: boolean }>;
  notices: Array<{ body: string; urgency: "INFO" | "IMPORTANT"; imageUrls?: string[] }>;
  fixedPrice: number | null;
  invoiceNote: string | null;
};
