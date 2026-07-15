/**
 * Cleaner daily-briefing payload — the typed shape returned by
 * `GET /api/cleaner/briefing` and consumed by the Today-page briefing panel.
 *
 * This module is deliberately dependency-free (no Prisma / server imports) so
 * the client component can import the types without pulling in server code.
 * Every section is nullable and each field null-safe: the assembler fills what
 * it can and leaves the rest null, and the UI renders only the sections that
 * carry content.
 */

export type BriefingDay = "today" | "tomorrow";

/** One scheduled stop on the day's run. */
export interface BriefingJob {
  id: string;
  propertyName: string;
  suburb: string | null;
  jobType: string; // human label, e.g. "Airbnb Turnover"
  startTime: string | null; // HH:mm (property local)
  dueTime: string | null; // HH:mm deadline
  estimatedHours: number | null;
  status: string;
  /** Has a completion deadline (dueTime) or an explicit early-check-in rule. */
  earlyCheckin: boolean;
  /** Starts late (after ~10:00) or carries an explicit late-checkout rule. */
  lateCheckout: boolean;
}

export interface BriefingJobsOverview {
  count: number;
  jobs: BriefingJob[];
}

export interface BriefingSpecialRequests {
  /** Client-requested extras + approved client task titles. */
  items: string[];
}

export interface BriefingLowStockItem {
  property: string;
  item: string;
  left: number;
  unit: string;
}

export interface BriefingLowStock {
  items: BriefingLowStockItem[]; // capped at 6
  moreCount: number; // items beyond the cap
}

export interface BriefingLaundry {
  totalTasks: number;
  /** Properties where linen needs to be ready for the clean. */
  properties: string[];
  line: string;
}

export interface BriefingWeather {
  summary: string; // "Partly cloudy · 12–22°C"
  wetWeatherGear: boolean;
  precipProbability: number | null; // %
  /** Heuristic traffic-buffer advice, when the first job lands in peak. */
  trafficBuffer: string | null;
  /** Weather-aware advisories tied to travel + outdoor work (rain / heat). */
  advisories?: string[];
}

// ── Accept gate — unaccepted (PENDING) assignments for the day ──────────────
export interface BriefingPendingJob {
  id: string;
  propertyName: string;
  suburb: string | null;
  jobType: string; // human label
  startTime: string | null; // HH:mm
}

export interface BriefingAcceptGate {
  /** PENDING assignments the cleaner still needs to accept in Jobs. */
  items: BriefingPendingJob[];
}

// ① Travel plan — leg-by-leg between consecutive accepted stops ─────────────
export interface BriefingTravelLeg {
  fromProperty: string;
  toProperty: string;
  etaMinutes: number | null; // driving minutes; null when unknown
  estimated: boolean; // true when eta is a haversine fallback (no maps key)
  nextStart: string | null; // next job start (HH:mm)
  leaveBy: string | null; // "leave by" clock (HH:mm) = nextStart − eta − buffer
  tight: boolean; // risk: current job + travel overflow the next start
}

export interface BriefingTravelPlan {
  legs: BriefingTravelLeg[];
}

// ② Access & quirks per stop ────────────────────────────────────────────────
export interface BriefingAccessStop {
  propertyName: string;
  items: string[]; // parking / lockbox / key / alarm / pet / access notes
}

export interface BriefingAccessNotes {
  stops: BriefingAccessStop[];
}

// ③ Last-visit context — previous QA outcome per property ────────────────────
export interface BriefingLastVisitItem {
  propertyName: string;
  score: number | null; // QAReview.score (as stored)
  passed: boolean | null;
  date: string | null; // d MMM
  flags: string[]; // prettified flagged-item labels (capped)
  reworkReason: string | null;
}

export interface BriefingLastVisit {
  items: BriefingLastVisitItem[];
}

// ④ New-to-you — properties the cleaner has never worked before ──────────────
export interface BriefingNewPropertyItem {
  jobId: string; // link target (the day's job at this property)
  propertyName: string;
  suburb: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  hasReferencePhotos: boolean;
}

export interface BriefingNewProperties {
  items: BriefingNewPropertyItem[];
}

// ⑤ Supplies to bring — inferred from extras + laundry ───────────────────────
export interface BriefingSupplyItem {
  item: string;
  reason: string; // why it's needed (property / extra)
}

export interface BriefingSupplies {
  items: BriefingSupplyItem[];
}

// ⑧ Turnaround / priority watch list ────────────────────────────────────────
export interface BriefingPriorityItem {
  propertyName: string;
  reason: string;
  kind: "tight-turnaround" | "due-time";
}

export interface BriefingPriorityWatch {
  items: BriefingPriorityItem[];
}

export interface BriefingEarnings {
  amount: number; // ex-GST, cleaner pay (incl. transport allowance)
  label: string; // "estimated"
  rateMissing: boolean;
  /** Transport allowance included in `amount`, when any. */
  transportAllowance?: number;
  /** Week-to-date total pay (Mon → today), when computable. */
  weekToDate?: number;
  /** Previous week's total pay, for a WTD comparison. */
  lastWeek?: number;
}

export interface BriefingFinishTime {
  startTime: string; // assumed/first start, e.g. "8:00 am"
  finishTime: string; // "~4:45 pm"
  totalHours: number;
  assumedStart: boolean; // true when no first startTime was set
  label: string; // "estimate"
}

export interface BriefingMistake {
  label: string;
  count: number;
  advice: string;
}

export interface BriefingWatchOuts {
  items: BriefingMistake[]; // top 3–5
}

export interface BriefingReminders {
  deviceLine: string | null;
  expiringDocuments: string[];
}

export interface BriefingComplaint {
  property: string;
  text: string;
  date: string; // dd MMM
}

export interface BriefingComplaints {
  items: BriefingComplaint[]; // capped at 3
}

export interface CleanerBriefing {
  day: BriefingDay;
  dateLabel: string; // "Saturday · 12 July"
  greetingName: string;
  generatedAt: string; // ISO
  jobsOverview: BriefingJobsOverview | null;
  specialRequests: BriefingSpecialRequests | null;
  lowStock: BriefingLowStock | null;
  laundry: BriefingLaundry | null;
  weather: BriefingWeather | null;
  earnings: BriefingEarnings | null;
  finishTime: BriefingFinishTime | null;
  watchOuts: BriefingWatchOuts | null;
  reminders: BriefingReminders | null;
  complaints: BriefingComplaints | null;
  /** PENDING assignments the cleaner must accept before working (accept gate). */
  acceptGate: BriefingAcceptGate | null;
  /** ① Ordered travel legs with leave-by times + tight-turnaround risks. */
  travelPlan: BriefingTravelPlan | null;
  /** ② Access & quirks per stop (parking, lockbox, alarm, pet). */
  accessNotes: BriefingAccessNotes | null;
  /** ③ Previous QA outcome per property (score + flags + rework reason). */
  lastVisit: BriefingLastVisit | null;
  /** ④ Properties the cleaner has never worked before. */
  newProperties: BriefingNewProperties | null;
  /** ⑤ Supplies to bring, inferred from extras + laundry. */
  supplies: BriefingSupplies | null;
  /** ⑧ Prioritised turnaround / due-time watch list. */
  priorityWatch: BriefingPriorityWatch | null;
  /** Natural, friendly 2nd-person spoken script (~60–90s). No markdown. */
  spokenScript: string;
}

/** Aggregate mistakes shape — exported for future admin reuse. */
export interface CleanerMistakeAggregate {
  cleanerId: string;
  windowDays: number;
  sampleSize: number; // reviews + transfers scanned
  items: BriefingMistake[];
}
