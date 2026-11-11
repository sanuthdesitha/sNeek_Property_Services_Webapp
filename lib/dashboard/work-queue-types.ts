/**
 * Command work queue: shapes shared by the server builder, the API route and
 * the client list. Free of server imports so client components can use them.
 */

export type WorkQueueUrgency = "now" | "today" | "week";

export type WorkQueueCategory = "dispatch" | "approvals" | "clients" | "money" | "quality" | "team";

/**
 * Every kind the queue can hold. The legacy kinds are the categories the old
 * Command "Needs attention" list, the shared immediate-attention panel and the
 * old Live ops planning lists produced; the rest are the inline decisions the
 * redesign added where an existing endpoint already exists.
 */
export type WorkQueueKind =
  | "unassigned-soon"
  | "unassigned-later"
  | "continuation"
  | "timing-request"
  | "skip-request"
  | "laundry-flagged"
  | "laundry-exception"
  | "laundry-draft"
  | "clock-adjustment"
  | "client-task"
  | "client-approval"
  | "case-overdue"
  | "case-high"
  | "case-new"
  | "case-open"
  | "case-stale"
  | "lost-item"
  | "lead-new"
  | "invoices-draft"
  | "invoices-outstanding"
  | "pay-request"
  | "shopping-reimbursement"
  | "qa-pending"
  | "qa-outcome"
  | "qa-rework"
  | "document-expiring"
  | "low-stock";

/** An inline action. Request actions call an existing endpoint unchanged. */
export type WorkQueueAction =
  | {
      kind: "request";
      label: string;
      method: "PATCH" | "POST";
      endpoint: string;
      body: Record<string, unknown>;
      /** Shown after the server confirmed the change. */
      doneLabel: string;
      /** Primary button styling (the design's dark button). */
      primary?: boolean;
      /**
       * The action needs a reason first (declining a continuation request):
       * the row opens the shared reason dialog and sends the reason in this
       * body field. The server refuses the request without it.
       */
      reason?: { field: "decisionNote"; subject: string };
    }
  | { kind: "assign"; label: string; jobId: string; primary?: boolean }
  | { kind: "link"; label: string; href: string; external?: boolean; primary?: boolean };

export type WorkQueueItem = {
  id: string;
  kind: WorkQueueKind;
  category: WorkQueueCategory;
  urgency: WorkQueueUrgency;
  title: string;
  detail: string;
  /** Destination page with the matching filter applied. */
  href: string;
  /** How many underlying records this row stands for (1 for a single record). */
  count: number;
  /**
   * A view over records another row already counts (e.g. high-priority cases
   * are also open cases). Shown, but left out of the chip totals.
   */
  overlap?: boolean;
  actions: WorkQueueAction[];
};

export type WorkQueueChipKey = "all" | WorkQueueCategory;

export type WorkQueueChip = { key: WorkQueueChipKey; label: string; count: number };

export type WorkQueuePayload = {
  items: WorkQueueItem[];
  chips: WorkQueueChip[];
  /** Sources that failed: their items are missing, so "all clear" is never claimed. */
  unavailable: string[];
  generatedAt: string;
};
