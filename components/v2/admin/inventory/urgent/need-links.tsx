"use client";

/**
 * How the Wave F links read on a need: "Reported by Jane C. during job J-1038"
 * (with a link; "Reported by Jane C." when the job is not recorded), the
 * shopping run it is on and what the run says about the item, and the latest
 * "buy" ask. Wording is truthful: on a run is not bought; asked is not bought.
 */
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import type { UrgentNeedListRow } from "@/lib/inventory/urgent-stock-list";
import { PURCHASE_ASK_LABEL } from "@/lib/inventory/urgent-stock-ask-state";

const linkClass = "font-[550] text-[hsl(var(--e-primary))] hover:underline";

export function ReportedBy({ row, suffix }: { row: Pick<UrgentNeedListRow, "reportedByName" | "sourceJob">; suffix?: string }) {
  const name = row.reportedByName ?? "someone not recorded";
  if (!row.sourceJob) return <>Reported by {name}{suffix}</>;
  return (
    <>
      Reported by {name} during job{" "}
      <Link className={linkClass} href={`/v2/admin/jobs/${row.sourceJob.id}`} onClick={(event) => event.stopPropagation()}>{row.sourceJob.jobNumber ?? "this job"}</Link>
      {suffix}
    </>
  );
}

/** One short line for the table: run or ask, or null. */
export function needLinkSummary(row: Pick<UrgentNeedListRow, "shoppingRun" | "purchaseAsk" | "unit">): string | null {
  const run = row.shoppingRun;
  if (run) {
    if (!run.line) return `Was on run "${run.title}" (line removed)`;
    if (run.line.purchased) return `Bought on run "${run.title}" · ${run.line.purchasedQty} ${row.unit}, not yet delivered`;
    return `On run "${run.title}"${run.open ? "" : " (closed)"}`;
  }
  const ask = row.purchaseAsk;
  if (ask && (ask.state === "ASKED" || ask.state === "DECLINED")) return `${PURCHASE_ASK_LABEL[ask.state]} ${ask.cleanerName}`;
  return null;
}

export function RunFact({ row }: { row: Pick<UrgentNeedListRow, "shoppingRun" | "unit"> }) {
  const run = row.shoppingRun;
  if (!run) return <>Not on a shopping run</>;
  const status = !run.line ? "the line was removed from the run" : run.line.purchased ? `bought ${run.line.purchasedQty} ${row.unit}; delivery still to be recorded` : `planned ${run.line.plannedQty} ${row.unit}${run.open ? "" : "; run closed"}`;
  return (
    <>
      <Link className={linkClass} href={`/v2/admin/inventory/shopping/${run.id}`}>{run.title}</Link> · {run.ownerName} · {status}
    </>
  );
}

export function AskFact({ row, timeZone }: { row: Pick<UrgentNeedListRow, "purchaseAsk" | "unit">; timeZone: string }) {
  const ask = row.purchaseAsk;
  if (!ask) return <>No cleaner asked</>;
  const asked = formatInTimeZone(new Date(ask.askedAt), timeZone, "d MMM HH:mm");
  const answered = ask.respondedAt ? `, answered ${formatInTimeZone(new Date(ask.respondedAt), timeZone, "d MMM HH:mm")}` : "";
  return (
    <>
      {PURCHASE_ASK_LABEL[ask.state]} · {ask.cleanerName} ({ask.quantity ?? "?"} {row.unit}) · asked by {ask.askedByName} {asked}{answered}
      {ask.responseNote ? <> — &ldquo;{ask.responseNote}&rdquo;</> : null}
    </>
  );
}
