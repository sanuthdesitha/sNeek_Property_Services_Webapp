/**
 * Where a link into the job page lands.
 *
 * The page is one timeline plus five tabs for heavy content (`?view=`). Old
 * links carried `?tab=` for the eleven tabs the page used to have (approval
 * queues, notification CTAs, the jobs board menu, the property history, the
 * holiday-rates return link); each keeps its meaning:
 *   schedule, people, quality, laundry, money, forms, scope → scroll to their
 *   stage (schedule also opens Reschedule); messages → Messages tab;
 *   activity → History tab; danger → opens the More menu; overview → top.
 * `#chat` (approvals "Client requests") opens the Messages tab; that is done
 * client-side because the hash never reaches the server.
 */
import { resolveJobDetailTab, type JobDetailTab } from "@/lib/jobs/detail-tabs";

export const JOB_PAGE_VIEWS = ["timeline", "answers", "photos", "clock", "messages", "history"] as const;
export type JobPageView = (typeof JOB_PAGE_VIEWS)[number];

export type JobStageAnchor =
  | "s-booking"
  | "s-scope"
  | "s-dispatch"
  | "s-site"
  | "s-submitted"
  | "s-qa"
  | "s-report"
  | "s-laundry"
  | "s-invoice";

/** Something the header opens on arrival (an old link's meaning). */
export type JobPageOpen = "reschedule" | "menu" | null;

export type JobPageTarget = {
  view: JobPageView;
  /** Element id to scroll to on arrival, or null for the top. */
  anchor: string | null;
  open: JobPageOpen;
};

const TAB_TARGETS: Record<JobDetailTab, JobPageTarget> = {
  overview: { view: "timeline", anchor: null, open: null },
  schedule: { view: "timeline", anchor: "s-booking", open: "reschedule" },
  people: { view: "timeline", anchor: "s-dispatch", open: null },
  quality: { view: "timeline", anchor: "s-qa", open: null },
  laundry: { view: "timeline", anchor: "s-laundry", open: null },
  // The billing editor and pay ledger open inside the Invoice stage.
  money: { view: "timeline", anchor: "billing", open: null },
  forms: { view: "timeline", anchor: "s-submitted", open: null },
  scope: { view: "timeline", anchor: "s-scope", open: null },
  messages: { view: "messages", anchor: "chat", open: null },
  activity: { view: "history", anchor: null, open: null },
  danger: { view: "timeline", anchor: null, open: "menu" },
};

function firstString(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

export function isJobPageView(value: string | null): value is JobPageView {
  return value !== null && (JOB_PAGE_VIEWS as readonly string[]).includes(value);
}

/**
 * Resolve the page's search params. An explicit `view` wins; otherwise an old
 * `tab` maps to its new home; an unknown value lands on the timeline.
 */
export function resolveJobPageTarget(searchParams: { view?: unknown; tab?: unknown } | undefined): JobPageTarget {
  const view = firstString(searchParams?.view);
  if (isJobPageView(view)) return { view, anchor: view === "messages" ? "chat" : null, open: null };
  const tab = firstString(searchParams?.tab);
  if (tab === null) return TAB_TARGETS.overview;
  return TAB_TARGETS[resolveJobDetailTab(tab)];
}

/** Canonical href for a view of a job. The timeline is the bare URL. */
export function jobPageViewHref(jobId: string, view: JobPageView): string {
  const base = `/v2/admin/jobs/${encodeURIComponent(jobId)}`;
  return view === "timeline" ? base : `${base}?view=${view}`;
}

/** The URL the `#chat` hash should move to, or null when already there. */
export function chatHashRedirect(jobId: string, currentView: JobPageView, hash: string): string | null {
  if (hash !== "#chat" || currentView === "messages") return null;
  return `${jobPageViewHref(jobId, "messages")}#chat`;
}
