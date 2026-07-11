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
}

export interface BriefingEarnings {
  amount: number; // ex-GST, cleaner pay
  label: string; // "estimated"
  rateMissing: boolean;
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
