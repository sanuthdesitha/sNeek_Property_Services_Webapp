/**
 * Maintenance visit › Cost (board "Maintenance portal", screen 2). Shows the
 * quoted cost and the client's decision exactly as stored. Nothing here
 * enforces a limit; it tells the worker what was approved and to ask the
 * office before going over it. No quote and no decision renders nothing.
 */
import { formatInTimeZone } from "date-fns-tz";
import { EBadge, ECard, ECardBody } from "@/components/v2/ui/primitives";

const TZ = "Australia/Sydney";

export interface VisitCostInput {
  quotedCost: number | null;
  costApprovalStatus: string | null;
  costDecidedAt: string | null;
}

function money(value: number): string {
  return `$${value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function decidedOn(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatInTimeZone(date, TZ, "d MMM") : null;
}

const LINES: Record<string, (decided: string | null) => string> = {
  APPROVED: (decided) => `Approved by the client${decided ? ` on ${decided}` : ""}. Ask the office before spending more than this.`,
  DECLINED: (decided) => `The client declined this cost${decided ? ` on ${decided}` : ""}. Contact the office before doing paid work.`,
  PENDING: () => "The client has not decided yet. Check with the office before committing to paid work.",
};

export function VisitCostCard({ cost }: { cost: VisitCostInput }) {
  const quoted = typeof cost.quotedCost === "number" && Number.isFinite(cost.quotedCost) ? cost.quotedCost : null;
  if (quoted === null && !cost.costApprovalStatus) return null;
  const decided = decidedOn(cost.costDecidedAt);
  const status = cost.costApprovalStatus ?? "";
  const badge =
    status === "APPROVED" ? <EBadge tone="success" soft>Approved</EBadge>
      : status === "DECLINED" ? <EBadge tone="danger" soft>Declined</EBadge>
        : status === "PENDING" ? <EBadge tone="warning" soft>Awaiting cost approval</EBadge>
          : <EBadge tone="neutral" soft>Quote only</EBadge>;
  const line = LINES[status]?.(decided) ?? "No client decision is recorded for this quote.";
  return (
    <ECard>
      <ECardBody className="space-y-1.5 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[0.875rem] font-[600]">Cost</h2>
          {badge}
        </div>
        <p className="e-numeral text-[1.25rem]">{quoted === null ? "Amount not set" : money(quoted)}</p>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{line}</p>
      </ECardBody>
    </ECard>
  );
}
