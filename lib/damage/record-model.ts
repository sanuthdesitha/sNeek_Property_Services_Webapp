/**
 * The damage report record page (board "Damage report", 2026-11-14): shapes
 * and the pure rules that turn stored facts into the page's progress, fact
 * tiles and history. Plain module (no server imports), safe for client
 * components and unit tests.
 *
 * Unknowns stay unknown: a blank estimate is "not estimated" and left out of
 * the total (never $0), a missing time is "not recorded", and the estimate
 * total always says how many items it covers.
 */

export type DamageAuditRow = {
  id: string;
  action: string;
  createdAt: string;
  actorName: string | null;
  before: unknown;
  after: unknown;
};

export type DamageVoidRow = { id: string; mode: string; reason: string; voidedByName: string | null; voidedAt: string };

export type DamageHistoryEntry = {
  id: string;
  at: string;
  /** Bold lead words ("Submitted", "Sent back"). */
  lead: string;
  /** The rest of the sentence. */
  detail: string;
  actorName: string | null;
};

export type DamageEstimateSummary = {
  /** Sum of the items that have an estimate, in dollars; null when none has one. */
  total: number | null;
  estimatedItems: number;
  itemCount: number;
};

export type DamageRecordContext = {
  job: { id: string; jobNumber: string | null; jobType: string; scheduledDate: string };
  property: { id: string; name: string };
  client: { id: string; name: string } | null;
  verification: { code: string; issuedAt: string; revoked: boolean } | null;
  /** Other submitted damage reports at this property before this one. */
  earlierReportsAtProperty: number;
  firstSubmittedAt: string | null;
  estimate: DamageEstimateSummary;
  history: DamageHistoryEntry[];
  /** The latest release and the message sent with it, while released. */
  lastRelease: { at: string; byName: string | null; message: string | null } | null;
  /** Case opened time per case id (for item history). */
  caseOpenedAt: Record<string, string>;
};

/** Sum of the estimates that exist, in whole cents; blanks are left out and counted. */
export function summariseEstimates(items: ReadonlyArray<{ estimatedCost: number | null }>): DamageEstimateSummary {
  let cents = 0;
  let estimatedItems = 0;
  for (const item of items) {
    if (item.estimatedCost === null || item.estimatedCost === undefined || !Number.isFinite(item.estimatedCost)) continue;
    cents += Math.round(item.estimatedCost * 100);
    estimatedItems += 1;
  }
  return { total: estimatedItems > 0 ? cents / 100 : null, estimatedItems, itemCount: items.length };
}

/** "$420.00 · 2 of 3 items · 1 not estimated", or "Not estimated · 0 of 3 items". */
export function estimateCoverageText(summary: DamageEstimateSummary): string {
  const missing = summary.itemCount - summary.estimatedItems;
  return [`${summary.estimatedItems} of ${summary.itemCount} item${summary.itemCount === 1 ? "" : "s"}`, missing > 0 ? `${missing} not estimated` : null].filter(Boolean).join(" · ");
}

const OUTCOME_WORDS: Record<string, string> = {
  queued: "queued",
  inbox_available: "in the inbox",
  provider_accepted: "accepted by the provider",
  requested: "requested",
  already_requested: "already sent",
  uncertain: "outcome unknown",
  skipped: "not sent",
  failed: "failed",
  switched_off: "switched off",
};

const TRANSPORT_WORDS: Record<string, string> = { INBOX: "inbox", EMAIL: "email", SMS: "SMS", MOBILE_PUSH: "phone push", WEB_PUSH: "browser push" };

/** "inbox in the inbox, email queued" — each transport's own state, never "read". */
export function releaseMessageText(after: unknown): string | null {
  if (!after || typeof after !== "object") return null;
  const outcomes = (after as { outcomes?: unknown }).outcomes;
  if (!Array.isArray(outcomes) || outcomes.length === 0) return null;
  const byTransport = new Map<string, Set<string>>();
  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== "object") continue;
    const row = outcome as { transport?: unknown; state?: unknown };
    if (typeof row.transport !== "string" || typeof row.state !== "string") continue;
    const states = byTransport.get(row.transport) ?? new Set<string>();
    states.add(OUTCOME_WORDS[row.state] ?? row.state.replace(/_/g, " "));
    byTransport.set(row.transport, states);
  }
  return Array.from(byTransport.entries()).map(([transport, states]) => `${TRANSPORT_WORDS[transport] ?? transport.toLowerCase()} ${Array.from(states).join(" / ")}`).join(", ") || null;
}

function money(amount: unknown): string | null {
  return typeof amount === "number" && Number.isFinite(amount) ? `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * The report's history, newest first: submissions, send-backs, the office's
 * decisions, estimate changes, the release message and the client's
 * sign-off. Reports from before submissions were logged fall back to the
 * stored submission time and the time their cases were opened.
 */
export function buildDamageHistory(input: {
  audits: DamageAuditRow[];
  voids: DamageVoidRow[];
  submittedAt: string | null;
  reportedByName: string | null;
  jobNumber: string | null;
  acknowledgedAt: string | null;
  acknowledgedName: string | null;
  itemNumberById: Record<string, number>;
  earliestCaseOpenedAt: string | null;
}): DamageHistoryEntry[] {
  const entries: DamageHistoryEntry[] = [];
  const submissions = input.audits.filter((row) => row.action === "DAMAGE_REPORT_SUBMITTED").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  submissions.forEach((row, index) => {
    const items = field(row.after, "itemCount");
    const photos = field(row.after, "photoCount");
    const facts = [typeof items === "number" ? `${items} item${items === 1 ? "" : "s"}` : null, typeof photos === "number" ? `${photos} photo${photos === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
    entries.push({
      id: row.id,
      at: row.createdAt,
      lead: index === 0 ? "Submitted" : "Resubmitted",
      detail: `by ${row.actorName ?? input.reportedByName ?? "the cleaner"}${index === 0 && input.jobNumber ? ` from ${input.jobNumber}` : ""}${facts ? ` · ${facts}` : ""}`,
      actorName: row.actorName,
    });
  });
  if (submissions.length === 0) {
    if (input.voids.length > 0 && input.earliestCaseOpenedAt) {
      entries.push({ id: "first-submission", at: input.earliestCaseOpenedAt, lead: "Submitted", detail: `by ${input.reportedByName ?? "the cleaner"}${input.jobNumber ? ` from ${input.jobNumber}` : ""} · time taken from when its cases were opened`, actorName: null });
    }
    if (input.submittedAt) {
      const resubmitted = input.voids.some((row) => row.voidedAt < input.submittedAt!);
      entries.push({ id: "submission", at: input.submittedAt, lead: resubmitted ? "Resubmitted" : "Submitted", detail: `by ${input.reportedByName ?? "the cleaner"}${!resubmitted && input.jobNumber ? ` from ${input.jobNumber}` : ""}`, actorName: null });
    }
  }
  for (const row of input.voids) {
    entries.push({
      id: row.id,
      at: row.voidedAt,
      lead: "Sent back",
      detail: `${row.mode === "CLEAR_AND_REDO" ? "cleared to start again" : "reopened for editing"} · "${row.reason}"${row.voidedByName ? ` · ${row.voidedByName}` : ""} · the cleaner was told`,
      actorName: row.voidedByName,
    });
  }
  for (const row of input.audits) {
    const by = row.actorName ? ` · ${row.actorName}` : "";
    switch (row.action) {
      case "DAMAGE_REPORT_RELEASED":
        entries.push({ id: row.id, at: row.createdAt, lead: "Released to the client", detail: `the report and its cases appear in their portal${by}`, actorName: row.actorName });
        break;
      case "DAMAGE_REPORT_TAKEN_BACK":
        entries.push({ id: row.id, at: row.createdAt, lead: "Taken back from the client", detail: `hidden from their portal again${by}`, actorName: row.actorName });
        break;
      case "DAMAGE_REPORT_CLOSED":
        entries.push({ id: row.id, at: row.createdAt, lead: "Closed without releasing", detail: `kept internal${by}`, actorName: row.actorName });
        break;
      case "DAMAGE_REPORT_CLOSED_RELEASED":
        entries.push({ id: row.id, at: row.createdAt, lead: "Closed", detail: `still visible to the client${by}`, actorName: row.actorName });
        break;
      case "DAMAGE_REPORT_REOPENED":
        entries.push({ id: row.id, at: row.createdAt, lead: "Reopened", detail: `back under review${by}`, actorName: row.actorName });
        break;
      case "DAMAGE_REPORT_REVIEWED":
        entries.push({ id: row.id, at: row.createdAt, lead: "Reviewed", detail: `kept under review${by}`, actorName: row.actorName });
        break;
      case "DAMAGE_RELEASE_NOTICE_SENT": {
        const text = releaseMessageText(row.after);
        entries.push({ id: row.id, at: row.createdAt, lead: "Client message", detail: `${text ?? "no transport took it"}${by}`, actorName: row.actorName });
        break;
      }
      case "DAMAGE_ITEM_ESTIMATE_SET": {
        const itemId = field(row.after, "itemId");
        const number = typeof itemId === "string" ? input.itemNumberById[itemId] : undefined;
        const amount = money(field(row.after, "estimatedCost"));
        entries.push({
          id: row.id,
          at: row.createdAt,
          lead: "Estimate",
          detail: `${number ? `item ${number}` : "a removed item"} ${amount ? `set to ${amount}` : "cleared (not estimated)"}${by}`,
          actorName: row.actorName,
        });
        break;
      }
      default:
        break;
    }
  }
  if (input.acknowledgedAt) {
    entries.push({ id: "acknowledged", at: input.acknowledgedAt, lead: "Acknowledged", detail: `by "${input.acknowledgedName ?? "the client"}" in the portal`, actorName: null });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

export type DamageStageState = "done" | "current" | "pending" | "passed" | "skipped" | "todo";
export type DamageStage = { key: string; label: string; state: DamageStageState; note: string };

/**
 * The progress strip: submitted, sent back, office review, released,
 * acknowledged, closed — from stored state only. `when` formats a time in
 * the organisation timezone.
 */
export function damageRecordStages(input: {
  status: string;
  firstSubmittedAt: string | null;
  submittedAt: string | null;
  voids: DamageVoidRow[];
  clientVisible: boolean;
  reviewedByName: string | null;
  reviewedAt: string | null;
  releasedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedName: string | null;
  closedAt: string | null;
}, when: (iso: string | null) => string | null): DamageStage[] {
  const sentBack = input.voids.length;
  const draft = input.status === "DRAFT";
  const closed = input.status === "CLOSED";
  const closedUnreleased = closed && !input.clientVisible;
  const latestVoid = input.voids.reduce<DamageVoidRow | null>((latest, row) => (!latest || row.voidedAt > latest.voidedAt ? row : latest), null);
  const sentBackNote = sentBack === 0
    ? "Not sent back"
    : `${sentBack === 1 ? "Once" : `${sentBack} times`}${latestVoid ? ` ${when(latestVoid.voidedAt) ?? ""}` : ""}${!draft && input.submittedAt ? `, resubmitted ${when(input.submittedAt) ?? ""}` : ""}`.trim();
  return [
    { key: "submitted", label: "Submitted", state: input.firstSubmittedAt || input.submittedAt ? "done" : "todo", note: when(input.firstSubmittedAt ?? input.submittedAt) ?? "Not recorded" },
    { key: "sent-back", label: sentBack ? (sentBack === 1 ? "Sent back once" : `Sent back ${sentBack} times`) : "Sent back", state: draft ? "current" : sentBack ? "done" : "passed", note: draft ? "Waiting for the cleaner to resubmit" : sentBackNote },
    {
      key: "review",
      label: "Office review",
      state: draft ? "todo" : input.clientVisible || closed ? "done" : "current",
      note: input.reviewedByName ? `${input.reviewedByName}${input.reviewedAt ? `, ${when(input.reviewedAt) ?? ""}` : ""}` : draft ? "After resubmission" : "Waiting",
    },
    { key: "released", label: "Released to client", state: input.clientVisible ? "done" : closedUnreleased ? "skipped" : "todo", note: input.clientVisible ? when(input.releasedAt) ?? "Time not recorded" : closedUnreleased ? "Closed without releasing" : "Not yet" },
    {
      key: "acknowledged",
      label: "Client acknowledged",
      state: input.acknowledgedAt ? "done" : closedUnreleased ? "skipped" : "todo",
      note: input.acknowledgedAt ? `${input.acknowledgedName ? `"${input.acknowledgedName}" ` : ""}${when(input.acknowledgedAt) ?? ""}`.trim() : closedUnreleased ? "Not released" : "Not yet",
    },
    { key: "closed", label: "Closed", state: closed ? "done" : "todo", note: closed ? when(input.closedAt) ?? "Time not recorded" : "Not yet" },
  ];
}
