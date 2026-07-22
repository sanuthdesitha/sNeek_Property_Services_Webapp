/**
 * QA PRE-INSPECTION BRIEF — rule engine (Phase 4 · Stage 1).
 *
 * Step 0 of the inspection workspace is a 30-second brief: who cleaned, how long
 * they took vs expected, what they submitted, and the handful of things that are
 * genuinely worth knowing BEFORE walking the property.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ADDING A RULE = ADDING ONE ENTRY TO `BRIEF_RULES`.
 *
 *  A rule is a pure function `(ctx: QaBriefContext) => BriefItem | null`.
 *  Return `null` when the rule does not apply. Rules must never throw, never do
 *  I/O, and never mutate the context — everything they need is already on it
 *  (extend `QaBriefContext` + the route's context builder if you need more).
 *  Order matters: `BRIEF_RULES` is evaluated top to bottom and the output keeps
 *  that order, so put the "you must know this" rules first.
 *
 *  Example:
 *      const petOnSite: BriefRule = (ctx) =>
 *        ctx.property.features?.petFriendly
 *          ? { id: "pet-on-site", tone: "info", title: "Pet in residence",
 *              detail: "Expect hair — check soft furnishings and floors." }
 *          : null;
 *      // then add `petOnSite,` to BRIEF_RULES.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pure module (no DB, no I/O) — unit-testable and importable from anywhere. The
 * server builds `QaBriefContext` in the QA GET route and ships `brief` down with
 * the rest of the inspection payload.
 */

export type BriefTone = "info" | "warning" | "danger";

export interface BriefItem {
  /** Stable rule id (also the React key). */
  id: string;
  tone: BriefTone;
  title: string;
  detail: string;
}

export type BriefRule = (ctx: QaBriefContext) => BriefItem | null;

export interface BriefCleaner {
  id: string;
  name: string;
}

export interface BriefStockLow {
  name: string;
  onHand: number;
  threshold: number;
}

export interface BriefWatchOut {
  label: string;
  count: number;
  category: string;
}

export interface QaBriefContext {
  /** Evaluation time (injected so rules stay deterministic in tests). */
  now: Date;
  job: {
    id: string;
    jobType: string;
    status: string;
    /** Cleaner's checklist is still outstanding after they clocked out. */
    formPendingAfterClockOut: boolean;
    /** Hours the job was estimated/allocated at. */
    expectedHours: number | null;
    /** Hours actually clocked (sum of TimeLog.durationM). */
    actualHours: number | null;
    isRework: boolean;
  };
  property: {
    id: string;
    name: string;
    sofaBedCount: number;
    hasBalcony: boolean;
  };
  cleaners: BriefCleaner[];
  submission: {
    submittedAt: string | null;
    photoCount: number;
  } | null;
  /** Property stock at or below its reorder threshold. */
  lowStock: BriefStockLow[];
  laundry: {
    required: boolean;
    confirmed: boolean;
  } | null;
  reservation: {
    /** Next guest check-in, ISO. */
    guestCheckInAt: string | null;
    guestName?: string | null;
  } | null;
  /** Recurring QA categories for this property (reuses the existing watchOuts). */
  propertyWatchOuts: BriefWatchOut[];
  /** Recurring QA categories for the primary cleaner. */
  cleanerWatchOuts: BriefWatchOut[];
  /** Primary cleaner's MAJOR/CRITICAL verdicts in the recent window. */
  cleanerRecentSevereIssues: { major: number; critical: number; windowDays: number };
  /** Prior completed jobs by this cleaner at this property (excluding this one). */
  cleanerPriorJobsAtProperty: number;
  /** Rework jobs spawned off this property in the recent window. */
  propertyReworkCount: number;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function hoursLabel(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}h`;
}

function minutesUntil(now: Date, iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.round((at - now.getTime()) / 60000);
}

function humanDuration(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs < 60) return `${abs} min`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/* ── rules ───────────────────────────────────────────────────────────────── */

/** Materially faster or slower than the allocated time. */
const timeVsExpected: BriefRule = (ctx) => {
  const expected = ctx.job.expectedHours;
  const actual = ctx.job.actualHours;
  if (!expected || expected <= 0 || actual == null || actual <= 0) return null;
  const ratio = actual / expected;
  if (ratio < 0.7) {
    return {
      id: "time-under",
      tone: ratio < 0.5 ? "danger" : "warning",
      title: `Finished well under time — ${hoursLabel(actual)} of ${hoursLabel(expected)}`,
      detail:
        "A short clean is the strongest predictor of skipped work. Check the items that take longest: oven, shower screens, skirtings, under beds.",
    };
  }
  if (ratio > 1.3) {
    return {
      id: "time-over",
      tone: "info",
      title: `Ran over time — ${hoursLabel(actual)} of ${hoursLabel(expected)}`,
      detail:
        "Ask what took the extra time. If the property genuinely needs more hours, flag it so the allocation is corrected.",
    };
  }
  return null;
};

/** The cleaner clocked out without finishing their checklist. */
const formPending: BriefRule = (ctx) =>
  ctx.job.formPendingAfterClockOut
    ? {
        id: "form-pending",
        tone: "warning",
        title: "Checklist still pending after clock-out",
        detail:
          "The cleaner clocked out before submitting the form, so their photos and confirmations may be incomplete or filled in from memory.",
      }
    : null;

/** No submission at all — nothing to review against. */
const noSubmission: BriefRule = (ctx) =>
  !ctx.submission
    ? {
        id: "no-submission",
        tone: "warning",
        title: "No cleaner submission on file",
        detail: "There is no submitted form for this job — inspect against the template only and note the gap.",
      }
    : null;

/** Consumables at or below their reorder threshold. */
const lowStock: BriefRule = (ctx) => {
  if (ctx.lowStock.length === 0) return null;
  const names = ctx.lowStock.slice(0, 6).map((s) => `${s.name} (${s.onHand})`);
  const extra = ctx.lowStock.length - names.length;
  return {
    id: "low-stock",
    tone: "warning",
    title: `${ctx.lowStock.length} item${ctx.lowStock.length === 1 ? "" : "s"} low on stock`,
    detail: `${names.join(", ")}${extra > 0 ? ` +${extra} more` : ""}. Count them while you're on site and raise a restock.`,
  };
};

/** Categories that keep failing AT THIS PROPERTY (reuses the watch-outs). */
const repeatPropertyIssues: BriefRule = (ctx) => {
  if (ctx.propertyWatchOuts.length === 0) return null;
  const parts = ctx.propertyWatchOuts.slice(0, 5).map((w) => `${w.label.toLowerCase()} ×${w.count}`);
  return {
    id: "repeat-property-issues",
    tone: "warning",
    title: "Repeat issues at this property",
    detail: `${parts.join(", ")}. Check these first — they have failed here before.`,
  };
};

/** The cleaner's recent MAJOR/CRITICAL verdicts. */
const cleanerSevereHistory: BriefRule = (ctx) => {
  const { major, critical, windowDays } = ctx.cleanerRecentSevereIssues;
  if (major + critical === 0) return null;
  const who = ctx.cleaners[0]?.name ?? "This cleaner";
  const parts = [critical ? `${critical} critical` : null, major ? `${major} major` : null].filter(Boolean);
  return {
    id: "cleaner-severe-history",
    tone: critical > 0 ? "danger" : "warning",
    title: `${who}: ${parts.join(" + ")} in the last ${windowDays} days`,
    detail:
      ctx.cleanerWatchOuts.length > 0
        ? `Recurring for them: ${ctx.cleanerWatchOuts.slice(0, 4).map((w) => w.label.toLowerCase()).join(", ")}.`
        : "Inspect their usual weak points closely and evidence anything you flag.",
  };
};

/** First visit to this property for the assigned cleaner. */
const firstTimeAtProperty: BriefRule = (ctx) => {
  if (ctx.cleaners.length === 0) return null;
  if (ctx.cleanerPriorJobsAtProperty > 0) return null;
  return {
    id: "first-time-at-property",
    tone: "info",
    title: `${ctx.cleaners[0].name}'s first clean at ${ctx.property.name}`,
    detail:
      "Expect property-specific misses (setup positions, linen presentation, bin day, sofa-bed make-up). Coach rather than penalise where it's a genuine first-time gap.",
  };
};

/** Sofa beds and balconies are the two most-missed property features. */
const sofaBedOrBalcony: BriefRule = (ctx) => {
  const parts: string[] = [];
  if (ctx.property.sofaBedCount > 0) {
    parts.push(`${ctx.property.sofaBedCount} sofa bed${ctx.property.sofaBedCount === 1 ? "" : "s"}`);
  }
  if (ctx.property.hasBalcony) parts.push("balcony");
  if (parts.length === 0) return null;
  return {
    id: "sofa-bed-balcony",
    tone: "info",
    title: `Commonly missed here: ${parts.join(" + ")}`,
    detail:
      "Open the sofa bed and check the mattress and linen inside; step out onto the balcony and check the floor, rail and furniture.",
  };
};

/** How long until the next guest arrives. */
const guestArrival: BriefRule = (ctx) => {
  const mins = minutesUntil(ctx.now, ctx.reservation?.guestCheckInAt);
  if (mins == null) return null;
  if (mins < 0) {
    return {
      id: "guest-arrival",
      tone: "danger",
      title: `Guests were due ${humanDuration(mins)} ago`,
      detail: "The property is already past check-in. Inspect fast and fix only what is guest-visible.",
    };
  }
  return {
    id: "guest-arrival",
    tone: mins <= 120 ? "danger" : mins <= 300 ? "warning" : "info",
    title: `Guests arrive in ${humanDuration(mins)}`,
    detail:
      mins <= 120
        ? "Tight turnaround — anything you flag for rework has to be fixable now, not tomorrow."
        : "Enough time for a same-day rework if you find something material.",
  };
};

/** Laundry required but never confirmed. */
const laundryOutstanding: BriefRule = (ctx) =>
  ctx.laundry && ctx.laundry.required && !ctx.laundry.confirmed
    ? {
        id: "laundry-outstanding",
        tone: "warning",
        title: "Laundry not confirmed",
        detail: "The laundry task for this job has no confirmation — verify linen counts and bag handover on site.",
      }
    : null;

/** This property keeps generating reworks. */
const propertyReworkHistory: BriefRule = (ctx) =>
  ctx.propertyReworkCount >= 2
    ? {
        id: "property-rework-history",
        tone: "warning",
        title: `${ctx.propertyReworkCount} reworks at this property recently`,
        detail:
          "Repeated reworks usually mean the allocated hours or the checklist are wrong, not just the cleaner. Note which it is.",
      }
    : null;

/**
 * ORDERED rule set. Add a rule by appending one entry (see the file header).
 */
export const BRIEF_RULES: BriefRule[] = [
  guestArrival,
  timeVsExpected,
  formPending,
  noSubmission,
  repeatPropertyIssues,
  cleanerSevereHistory,
  propertyReworkHistory,
  laundryOutstanding,
  lowStock,
  firstTimeAtProperty,
  sofaBedOrBalcony,
];

/** Evaluate every rule in order. A throwing rule is skipped, never fatal. */
export function buildQaBrief(ctx: QaBriefContext, rules: BriefRule[] = BRIEF_RULES): BriefItem[] {
  const out: BriefItem[] = [];
  for (const rule of rules) {
    let item: BriefItem | null = null;
    try {
      item = rule(ctx);
    } catch {
      item = null;
    }
    if (item) out.push(item);
  }
  return out;
}

/** Highest tone present, for the summary chip. */
export function briefSeverity(items: BriefItem[]): BriefTone {
  if (items.some((i) => i.tone === "danger")) return "danger";
  if (items.some((i) => i.tone === "warning")) return "warning";
  return "info";
}
