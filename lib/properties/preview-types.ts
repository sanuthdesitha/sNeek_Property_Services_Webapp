/** Shapes of the property side panel and the property page summaries. Pure; safe for client bundles. */
import type { CalendarState, PortfolioFlag, QaFigure } from "./portfolio-options";
import type { ComingUpRow } from "./coming-up";

export type UpcomingJob = {
  jobId: string;
  jobNumber: string;
  dayKey: string;
  startTime: string | null;
  jobType: string;
  status: string;
  cleaners: string[];
};

export type CareItem = { id: string; title: string; due: string | null; plannedDayKey: string | null; jobNumber: string | null };

export type RecentEvent = { kind: "qa" | "laundry" | "change"; at: string; text: string };

export type ChecklistSummary = { name: string; version: number; source: "property_override" | "global_latest" | "job_pin" | "none" } | null;

export type LaundrySummary = {
  enabled: boolean;
  partners: Array<{ id: string; name: string; partnerName: string | null; turnaroundHours: number | null; active: boolean }>;
  bagLabel: string | null;
  bagColor: string | null;
};

export type PropertyPreview = {
  id: string;
  name: string;
  address: string;
  suburb: string;
  client: { id: string; name: string };
  imageUrl: string | null;
  bedrooms: number;
  bathrooms: number;
  sofaBedCount: number;
  calendar: CalendarState;
  flags: PortfolioFlag[];
  qa: QaFigure;
  checklist: ChecklistSummary;
  laundry: LaundrySummary;
  access: { lockbox: string | null; parking: string | null; instructions: string | null; codeRecorded: boolean; guideSteps: number };
  upcoming: UpcomingJob[];
  recentJobs: UpcomingJob[];
  care: CareItem[];
  recent: RecentEvent[];
};

export type ClientSummary = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  propertyCount: number;
  paymentTermsDays: number | null;
  /** Null when the viewer has no finance access, or the figure could not be read. */
  owingAud: number | null;
  owingShown: boolean;
};

export type StockSummary = {
  tracked: number;
  atOrBelowReorder: Array<{ name: string; onHand: number; parLevel: number; reorderThreshold: number }>;
};

export type RateSummary = Array<{ jobType: string; baseCharge: number; billingUnit: string; isActive: boolean }>;

export type DocumentItem = { label: string; name: string; url: string; source: "access" | "intake" };
export type DetailItem = { label: string; value: string };

export type PropertyOverview = {
  comingUp: ComingUpRow[];
  comingUpWindowDays: number;
  lastClean: { dayKey: string; jobId: string; jobNumber: string } | null;
  client: ClientSummary;
  laundry: LaundrySummary;
  nfc: { active: number; labels: string[]; required: boolean };
  stock: StockSummary;
  rates: RateSummary;
  documents: DocumentItem[];
  details: DetailItem[];
};
