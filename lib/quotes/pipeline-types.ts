/**
 * Leads and quotes as one pipeline (owner board "Quotes and pricing", 2026-11).
 * Plain module: stages, row shape, the one next step per row, and the margin
 * estimate, shared by the list route and the screen.
 *
 * Stages: a lead with no quote shows its own status; a quote shows its status.
 *   New / Contacted   — leads at that status
 *   Quoted            — leads marked quoted, and draft, sent or accepted quotes
 *                       (an accepted quote is still open until jobs are booked)
 *   Won               — converted quotes and converted leads
 *   Lost              — declined quotes and lost leads
 *   Open              — New + Contacted + Quoted
 */

import { formatQuoteReference } from "./quote-reference";

export const PIPELINE_STAGES = ["open", "new", "contacted", "quoted", "won", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  open: "Open",
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

export const PIPELINE_SORTS = ["updated", "enquiry", "value", "status"] as const;
export type PipelineSort = (typeof PIPELINE_SORTS)[number];

export type PipelineKind = "lead" | "quote";

export type PipelineRow = {
  kind: PipelineKind;
  id: string;
  /** Client or lead name. */
  name: string;
  /** "Q-204" quote reference (Quote.quoteNumber); "Lead · Randwick" for leads. */
  reference: string;
  serviceType: string;
  suburb: string | null;
  /** Quote total, or null for a lead. */
  total: number | null;
  /** Lead estimate range, or null. */
  estimateMin: number | null;
  estimateMax: number | null;
  /** Estimated margin as a fraction (0.38), or null when it cannot be worked out. */
  margin: number | null;
  belowFloor: boolean;
  status: string;
  stage: Exclude<PipelineStage, "open">;
  frequency: string | null;
  clientId: string | null;
  leadId: string | null;
  email: string | null;
  phone: string | null;
  convertedJobId: string | null;
  hasQuote: boolean;
  updatedAt: string;
  createdAt: string;
};

export type PipelineCounts = Record<PipelineStage, number>;

export function leadStage(status: string): Exclude<PipelineStage, "open"> {
  if (status === "CONTACTED") return "contacted";
  if (status === "QUOTED") return "quoted";
  if (status === "CONVERTED") return "won";
  if (status === "LOST") return "lost";
  return "new";
}

export function quoteStage(status: string): Exclude<PipelineStage, "open"> {
  if (status === "CONVERTED") return "won";
  if (status === "DECLINED") return "lost";
  return "quoted";
}

export function stageMatches(rowStage: Exclude<PipelineStage, "open">, filter: PipelineStage): boolean {
  if (filter === "open") return rowStage === "new" || rowStage === "contacted" || rowStage === "quoted";
  return rowStage === filter;
}

export type PipelinePrimary =
  | { kind: "link"; label: string; href: string }
  | { kind: "send"; label: string }
  | { kind: "counter"; label: string }
  | { kind: "convert"; label: string }
  | { kind: "none" };

/** The one next step a row shows; every other action is in its menu. */
export function pipelinePrimary(row: Pick<PipelineRow, "kind" | "id" | "status" | "leadId" | "estimateMin" | "estimateMax" | "convertedJobId" | "clientId">): PipelinePrimary {
  if (row.kind === "lead") {
    if (row.status === "NEW" || row.status === "QUOTED") return { kind: "link", label: "Make quote", href: `/v2/admin/quotes/new?leadId=${encodeURIComponent(row.id)}` };
    if (row.status === "CONTACTED") {
      return row.estimateMin != null || row.estimateMax != null
        ? { kind: "counter", label: "Counter offer" }
        : { kind: "link", label: "Make quote", href: `/v2/admin/quotes/new?leadId=${encodeURIComponent(row.id)}` };
    }
    if (row.status === "CONVERTED" && row.clientId) return { kind: "link", label: "View client", href: `/v2/admin/clients/${row.clientId}` };
    return { kind: "none" };
  }
  switch (row.status) {
    case "DRAFT":
      return { kind: "send", label: "Send" };
    case "SENT":
      return { kind: "link", label: "Follow up", href: `/v2/admin/quotes/${row.id}` };
    case "ACCEPTED":
      return { kind: "link", label: "Book jobs", href: `/v2/admin/quotes/${row.id}#convert` };
    case "CONVERTED":
      return row.convertedJobId ? { kind: "link", label: "Open job", href: `/v2/admin/jobs/${row.convertedJobId}` } : { kind: "link", label: "View", href: `/v2/admin/quotes/${row.id}` };
    default:
      return { kind: "link", label: "View", href: `/v2/admin/quotes/${row.id}` };
  }
}

export type MarginInputs = {
  /** Sum of positive line totals (price before discounts). */
  positiveSubtotal: number;
  /** What is charged before GST (after discounts). */
  netSubtotal: number;
  rackHourlyRate: number;
  cleanerHourlyCost: number;
  marginFloorPercent: number;
};

/**
 * The margin-floor model the quote routes already use: cost is
 * positiveSubtotal × (cleaner cost / rack rate), capped at 95 %. Null when the
 * rate card or the price cannot support an estimate — never zero.
 */
export function estimateMargin(input: MarginInputs): { margin: number | null; belowFloor: boolean } {
  if (!(input.rackHourlyRate > 0) || !(input.cleanerHourlyCost > 0) || !(input.netSubtotal > 0) || !(input.positiveSubtotal > 0)) {
    return { margin: null, belowFloor: false };
  }
  const costShare = Math.min(0.95, input.cleanerHourlyCost / input.rackHourlyRate);
  const cost = input.positiveSubtotal * costShare;
  const margin = (input.netSubtotal - cost) / input.netSubtotal;
  return { margin, belowFloor: margin * 100 < input.marginFloorPercent };
}

/**
 * The quote's reference as clients see it ("Q-204", from `Quote.quoteNumber`).
 * Given only an id (a caller that has not read the number), the older id-based
 * short form is kept so nothing renders blank.
 */
export function shortQuoteRef(quote: string | { id: string; quoteNumber?: number | null }): string {
  if (typeof quote !== "string") {
    const reference = formatQuoteReference(quote.quoteNumber);
    if (reference) return reference;
  }
  const id = typeof quote === "string" ? quote : quote.id;
  return `Q-${id.slice(-6).toUpperCase()}`;
}
