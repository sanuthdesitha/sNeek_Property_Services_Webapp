/**
 * Supplies → To do (approved board, 2026-11): what is waiting for this cleaner
 * across supplies, each with the one action that moves it on.
 *
 *   1. Office "Can you buy these?" asks (the existing PurchaseAsksCard).
 *   2. Their shopping run still being worked on (receipt state, bought so far).
 *   3. Stock counts somebody asked them to do (Quick scan / Full count).
 *   4. Urgent stock they reported and its recorded stage.
 *
 * Presentational: the server page reads and scopes every row. A report is not
 * an order and a run is not a reimbursement; the copy says so.
 */
import Link from "next/link";
import { Info } from "lucide-react";
import { EBadge, EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { PurchaseAsksCard } from "@/components/v2/cleaner/purchase-asks-card";
import { urgentStageLabel } from "@/lib/cleaner/supplies-view";
import { formatAud } from "@/lib/cleaner/today-view";

export interface TodoScanTask {
  id: string;
  propertyId: string;
  propertyLabel: string;
  requestedBy: string;
  dueLabel: string | null;
  instructions: string | null;
}

export interface TodoShoppingRun {
  id: string;
  title: string;
  status: string;
  linesTotal: number;
  linesBought: number;
  /** Sum of recorded line costs for bought lines; null when none recorded. */
  spent: number | null;
  /** Bought lines whose cost is not recorded yet. */
  boughtWithoutCost: number;
  receipts: number;
}

export interface TodoUrgentReport {
  id: string;
  itemName: string;
  propertyName: string;
  stage: string;
  updatedLabel: string;
}

export interface SuppliesTodoProps {
  shoppingEnabled: boolean;
  scanTasks: TodoScanTask[] | null;
  runs: TodoShoppingRun[] | null;
  urgentReports: TodoUrgentReport[] | null;
}

function Unavailable({ what }: { what: string }) {
  return <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{what} could not be loaded. Refresh to try again.</p>;
}

function RunCard({ run }: { run: TodoShoppingRun }) {
  const spentLine = run.spent != null ? `${formatAud(run.spent)} so far` : "No costs recorded yet";
  return (
    <ECard className="space-y-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[0.9375rem] font-[600] [overflow-wrap:anywhere]">Shopping run: {run.title}</h3>
        {run.receipts === 0 ? <EBadge tone="warning" soft>Receipt missing</EBadge> : <EBadge tone="neutral" soft>{run.receipts} receipt{run.receipts === 1 ? "" : "s"}</EBadge>}
      </div>
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        {run.linesBought} of {run.linesTotal} bought · {spentLine}
        {run.boughtWithoutCost > 0 ? ` · ${run.boughtWithoutCost} without a cost` : ""}
      </p>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Reimbursed on your next invoice once the office approves the receipt.</p>
    </ECard>
  );
}

function ScanTaskCard({ task }: { task: TodoScanTask }) {
  return (
    <ECard className="space-y-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[0.9375rem] font-[600]">Stock count due</h3>
        {task.dueLabel ? <EBadge tone="warning" soft>Before {task.dueLabel}</EBadge> : null}
      </div>
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))] [overflow-wrap:anywhere]">
        {task.propertyLabel} · {task.requestedBy} asked{task.instructions ? ` · ${task.instructions}` : ""}
      </p>
      <div className="flex gap-2 pt-1">
        <EButton asChild variant="outline" size="sm" className="min-h-11 flex-1">
          <Link href={`/v2/cleaner/quick-scan/${task.propertyId}`}>Quick scan</Link>
        </EButton>
        <EButton asChild variant="outline" size="sm" className="min-h-11 flex-1">
          <Link href={`/v2/cleaner/stock-count/${task.propertyId}?task=${task.id}`}>Full count</Link>
        </EButton>
      </div>
    </ECard>
  );
}

export function SuppliesTodo({ shoppingEnabled, scanTasks, runs, urgentReports }: SuppliesTodoProps) {
  const openRun = runs?.[0] ?? null;
  const nothingKnown = scanTasks?.length === 0 && runs?.length === 0 && urgentReports?.length === 0;

  return (
    <div className="space-y-4">
      {/* Hidden by itself when there is nothing to answer. */}
      <PurchaseAsksCard />

      {shoppingEnabled ? (runs === null ? <Unavailable what="Your shopping runs" /> : runs.map((run) => <RunCard key={run.id} run={run} />)) : null}

      {scanTasks === null ? <Unavailable what="Stock counts you were asked to do" /> : scanTasks.map((task) => <ScanTaskCard key={task.id} task={task} />)}

      {urgentReports === null ? (
        <Unavailable what="Urgent stock you reported" />
      ) : urgentReports.length > 0 ? (
        <ECard className="space-y-2 px-3 py-2.5">
          <h3 className="text-[0.9375rem] font-[600]">Urgent stock you reported</h3>
          <ul className="space-y-1">
            {urgentReports.map((report) => (
              <li key={report.id} className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))] [overflow-wrap:anywhere]">
                <span className="font-[550] text-[hsl(var(--e-foreground))]">{report.itemName}, {report.propertyName}</span>
                {" · "}{urgentStageLabel(report.stage)} {report.updatedLabel}
              </li>
            ))}
          </ul>
        </ECard>
      ) : null}

      {nothingKnown ? (
        <EEmptyState eyebrow="Supplies" title="No runs, counts or reports waiting" description="Open shopping runs, counts you are asked to do and your urgent reports appear here. Office buy asks show above when there are any." />
      ) : null}

      <p className="flex items-start gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        A report tells the office what is needed. It does not order anything or prove delivery.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <EButton asChild variant="gold" className="min-h-11 flex-1">
          <Link href="/v2/cleaner/supplies?tab=urgent-stock">Report urgent need</Link>
        </EButton>
        {shoppingEnabled && openRun ? (
          <EButton asChild variant="outline" className="min-h-11 flex-1">
            <Link href={`/v2/cleaner/shopping/${openRun.id}`}>Open run</Link>
          </EButton>
        ) : null}
      </div>
    </div>
  );
}
