/**
 * 8 · Laundry — supplier, planned against actual pickup and drop-off, weight
 * and cost when recorded, with the evidence photos and confirmations behind a
 * disclosure (moved from the Laundry tab; correcting the submission's outcome
 * lives in the Submitted stage).
 * 9 · Invoice and pay — the job's invoice lines with status and paid date,
 * the billing editor and pay ledger, and (administrators) the job's public
 * holiday review (moved from the Money tab and the Activity tab's "Linked
 * records").
 */
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { isLiveInvoiceLine } from "@/lib/jobs/invoiced-rule";
import { formatMoney } from "@/lib/jobs/job-page/money";
import type { TimelineStage } from "@/lib/jobs/job-page/timeline";
import { JobDetailManage } from "../job-detail-reviews";
import { JobDisclosure } from "./job-disclosure";
import { titleCase, type JobPageData } from "./job-page-data";
import { Muted, StageShell } from "./stage-shell";

function day(value: Date | null | undefined, timeZone: string, pattern = "EEE d MMM"): string | null {
  return value ? formatInTimeZone(value, timeZone, pattern) : null;
}

export function StageLaundry({ data, stage, collapsed }: { data: JobPageData; stage: TimelineStage; collapsed: boolean }) {
  const task = data.job.laundryTask;
  const tz = data.timeZone;
  const actions = <Link href="/v2/admin/laundry" className="inline-flex min-h-11 items-center font-[550] text-[hsl(var(--e-accent-portal))] hover:underline">Open in Laundry</Link>;
  if (!task) return <StageShell stage={stage} collapsed={collapsed} />;
  const images: Array<{ url: string; label: string }> = [];
  if (task.pickupKeyPhotoUrl) images.push({ url: task.pickupKeyPhotoUrl, label: "Key at pickup" });
  if (task.dropoffKeyPhotoUrl) images.push({ url: task.dropoffKeyPhotoUrl, label: "Key returned at drop-off" });
  if (task.receiptImageUrl) images.push({ url: task.receiptImageUrl, label: "Drop-off receipt" });
  for (const confirmation of task.confirmations) {
    if (confirmation.photoUrl) images.push({ url: confirmation.photoUrl, label: `Confirmation ${day(confirmation.createdAt, tz, "d MMM")}` });
  }
  const measured = [task.bagWeightKg != null ? `${task.bagWeightKg} kg` : null, task.dropoffCostAud != null ? formatMoney(task.dropoffCostAud) : null].filter(Boolean).join(" · ");
  return (
    <StageShell stage={stage} actions={actions} collapsed={collapsed}>
      <p className="tabular-nums">
        <EBadge tone="info" soft>{titleCase(String(task.status))}</EBadge>{" "}
        {task.noPickupRequired ? <EBadge tone="neutral" soft>No pickup required</EBadge> : null}{" "}
        <Muted>
          pickup {day(task.pickupDate, "UTC")}, {task.pickedUpAt ? `done ${day(task.pickedUpAt, tz, "d MMM HH:mm")}` : "not yet"} · drop-off {day(task.dropoffDate, "UTC")}, {task.droppedAt ? `done ${day(task.droppedAt, tz, "d MMM HH:mm")}` : "not yet"} · {measured || "weight and cost not recorded"}
          {task.confirmedAt ? ` · confirmed ${day(task.confirmedAt, tz, "d MMM HH:mm")}` : ""}
        </Muted>
      </p>
      {task.flagNotes ? <p className="text-[hsl(var(--e-muted-foreground))]">{task.flagNotes}</p> : null}
      {images.length > 0 || task.confirmations.length > 0 ? (
        <JobDisclosure id="laundry-evidence" label="Evidence and confirmations" description="Key photos, the drop-off receipt and each laundry confirmation.">
          {images.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {images.map((image) => (
                <a key={image.url} href={image.url} target="_blank" rel="noreferrer" className="block min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 hover:border-[hsl(var(--e-border-strong))]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={image.label} className="mb-2 h-28 w-full rounded object-cover" />
                  <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{image.label}</span>
                </a>
              ))}
            </div>
          ) : null}
          <ul className="space-y-1 pt-2">
            {task.confirmations.map((confirmation) => (
              <li key={confirmation.id} className="text-[hsl(var(--e-muted-foreground))]">
                {day(confirmation.createdAt, tz, "d MMM HH:mm")} · {confirmation.laundryReady ? "Ready" : "Not ready"}
                {confirmation.bagLocation ? ` · ${confirmation.bagLocation}` : ""}
                {confirmation.notes ? ` · ${confirmation.notes}` : ""}
              </li>
            ))}
          </ul>
        </JobDisclosure>
      ) : null}
    </StageShell>
  );
}

function invoiceTone(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === "PAID") return "success";
  if (status === "VOID") return "danger";
  if (status === "PART_PAID") return "warning";
  return "neutral";
}

export function StageInvoice({ data, stage, collapsed }: { data: JobPageData; stage: TimelineStage; collapsed: boolean }) {
  const { job, viewer } = data;
  const lines = job.invoiceLines;
  const onlyVoid = lines.length > 0 && !lines.some(isLiveInvoiceLine);
  const actions = <Link href="/v2/admin/finance/invoices" className="inline-flex min-h-11 items-center font-[550] text-[hsl(var(--e-accent-portal))] hover:underline">Invoices</Link>;
  return (
    <StageShell stage={stage} actions={actions} collapsed={collapsed}>
      {lines.length === 0 ? (
        <Muted>Not invoiced yet. Cleaner pay settles at payroll from clocked time.</Muted>
      ) : (
        <>
          {onlyVoid ? <Muted>Not on a live invoice. Every line below is on a voided or fully credited invoice, so this job can be billed again.</Muted> : null}
          <ul className="space-y-1.5">
            {lines.map((line) => {
              const paid = line.invoice?.paidDate ?? line.invoice?.paidAt ?? null;
              return (
                <li key={line.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {line.invoice ? <Link href={`/v2/admin/finance/invoices/${encodeURIComponent(line.invoice.id)}`} className="font-[550] text-[hsl(var(--e-accent-portal))] hover:underline">{line.invoice.invoiceNumber ?? "Invoice"}</Link> : <span className="font-[550]">Invoice</span>}
                    <Muted> · {line.description}</Muted>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="tabular-nums">{formatMoney(line.lineTotal)}</span>
                    {paid ? <Muted>paid {day(paid, data.timeZone, "d MMM yyyy")}</Muted> : null}
                    {line.invoice?.status ? <EBadge tone={invoiceTone(String(line.invoice.status))} soft>{titleCase(String(line.invoice.status))}</EBadge> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {job.invoiceNote ? <Muted>Invoice note: “{job.invoiceNote}”</Muted> : null}
      <JobDisclosure id="billing" label="Billing and pay ledger" description="Fixed client price, invoice note, and each payee's pay with every adjustment.">
        <JobDetailManage job={data.manageJob} section="billing" />
      </JobDisclosure>
      {viewer.isAdmin ? (
        <div>
          <EButton asChild variant="outline" size="sm">
            <Link href={`/v2/admin/settings?tab=holiday-rates&jobId=${encodeURIComponent(job.id)}`}>Review public holiday rates</Link>
          </EButton>
        </div>
      ) : null}
    </StageShell>
  );
}
