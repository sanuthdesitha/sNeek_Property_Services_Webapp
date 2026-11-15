"use client";

/**
 * The pay run page (board "Pay run" and "Pay run and cleaner invoice, phone",
 * 2026-11-17): heading with the run's status, one primary action per stage and
 * a More menu; the stage bar; the stored totals; the payouts; what processing
 * does; the ABA file and roles; the run's history. Everything shown is stored
 * (lib/payroll/run-view.ts); after an action the server data is re-read.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { EToneCard, EToneNotice } from "@/components/v2/ui/tone-band";
import {
  PAYROLL_RUN_STATUS_LABEL,
  abaAvailable,
  isBankPayout,
  payrollPrimaryAction,
  payrollRunStages,
  type PayrollRunStatusName,
} from "@/lib/payroll/run-presentation";
import type { PayrollRunView } from "@/lib/payroll/run-view";
import { aud, clock, people, periodTitleFromDays, plural, stamp } from "../../pay-records/format";
import { FactTiles, HistoryList, MUTED, RailCard, SMALL } from "../../pay-records/record-parts";
import { PayrollRunDialogs, type PayrollDialog } from "./payroll-run-dialogs";
import { PayoutTable } from "./payout-table";

const RUN_TONE: Record<string, EPillTone> = {
  DRAFT: "neutral",
  CONFIRMED: "info",
  PROCESSING: "warn",
  COMPLETED: "ok",
  FAILED: "bad",
  VOID: "neutral",
};

const BACK = "/v2/admin/finance?tab=payroll";

function useAbaDownload(runId: string) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const download = React.useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/payroll/runs/${runId}/aba`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast({ title: "ABA failed", description: body.error ?? "Failed to generate ABA file", variant: "destructive" });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `payroll-${runId}.aba`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }, [runId, toast]);
  return { busy, download };
}

function primaryButton(run: PayrollRunView, isAdmin: boolean, open: (dialog: PayrollDialog) => void, aba: { busy: boolean; download: () => void }, disabled: boolean, className?: string): React.ReactNode {
  const action = payrollPrimaryAction(run.status, isAdmin);
  switch (action.kind) {
    case "confirm":
      return <EButton size="sm" className={className} disabled={disabled} onClick={() => open({ kind: "confirm" })}>Confirm run…</EButton>;
    case "process":
      return <EButton size="sm" className={className} disabled={disabled} onClick={() => open({ kind: "process" })}>Process payouts…</EButton>;
    case "set-back-confirmed":
      return <EButton size="sm" className={className} disabled={disabled} onClick={() => open({ kind: "run-status", preset: "CONFIRMED" })}>Set back to Confirmed…</EButton>;
    case "process-admin-only":
    case "failed-admin-only":
      return (
        <EButton size="sm" className={className} disabled title={action.hint} aria-describedby="payroll-admin-only">
          {action.kind === "process-admin-only" ? "Process payouts…" : "Set back to Confirmed…"}
        </EButton>
      );
    case "download-aba":
      return <EButton size="sm" className={className} disabled={disabled || aba.busy} onClick={() => aba.download()}>{aba.busy ? "Generating…" : "Download ABA file"}</EButton>;
    default:
      return null;
  }
}

function moreItems(run: PayrollRunView, isAdmin: boolean, open: (dialog: PayrollDialog) => void, aba: { download: () => void }): ERowMenuItem[] {
  const items: ERowMenuItem[] = [];
  const primary = payrollPrimaryAction(run.status, isAdmin).kind;
  if (abaAvailable(run.status) && primary !== "download-aba") items.push({ key: "aba", label: "Download ABA file", onSelect: () => aba.download() });
  items.push({ key: "adjustments", label: "Adjustments", href: "/v2/admin/finance?tab=adjustments" });
  items.push(
    isAdmin
      ? { key: "status", label: "Set status manually…", heading: "Corrections", separated: true, onSelect: () => open({ kind: "run-status" }) }
      : { key: "status", label: "Set status manually…", heading: "Corrections", separated: true, disabled: true, hint: "Only an administrator can change a pay run's status." },
  );
  return items;
}

function facts(run: PayrollRunView) {
  const jobs = run.payouts.reduce((count, payout) => count + payout.jobCount, 0);
  const shopping = run.payouts.filter((payout) => payout.shoppingReimbursement !== 0).length;
  const adjusted = run.payouts.filter((payout) => payout.adjustments !== 0).length;
  const stripe = run.payouts.filter((payout) => payout.method === "STRIPE_CONNECT").length;
  const bank = run.payouts.filter((payout) => isBankPayout(payout.method)).length;
  return [
    { key: "job", label: "Job pay", value: aud(run.totalPayable), note: `${plural(jobs, "job")} at their rate snapshots` },
    { key: "shopping", label: "Shopping", value: run.totalShoppingReimbursements === 0 ? "None" : aud(run.totalShoppingReimbursements), note: shopping ? `${plural(shopping, "person", "people")} reimbursed` : "no reimbursements" },
    { key: "transport", label: "Transport", value: run.totalTransportAllowances === 0 ? "None" : aud(run.totalTransportAllowances), note: "allowances" },
    {
      key: "adjustments",
      label: "Adjustments",
      value: run.totalAdjustments === 0 ? "None" : aud(run.totalAdjustments),
      note: adjusted ? <Link href="/v2/admin/finance?tab=adjustments" className="underline underline-offset-2">{plural(adjusted, "payout")} with adjustments</Link> : "none this run",
    },
    { key: "total", label: "Grand total", value: aud(run.grandTotal), note: `${stripe} by Stripe Connect · ${bank} by bank transfer`, gold: true },
  ];
}

function ProcessingCard({ run, isAdmin, open }: { run: PayrollRunView; isAdmin: boolean; open: (dialog: PayrollDialog) => void }) {
  const stripe = run.payouts.filter((payout) => payout.method === "STRIPE_CONNECT").length;
  const bank = run.payouts.filter((payout) => isBankPayout(payout.method)).length;
  const failed = run.payouts.filter((payout) => payout.status === "FAILED");
  return (
    <RailCard title={'After "Process payouts": what each person sees'} aria-label="After processing">
      <ul className={cn("space-y-1", SMALL)}>
        <li><b>Stripe Connect, {people(stripe)}</b> <span className={MUTED}>sent now; each row then shows Paid, or Failed with Stripe&apos;s reason</span></li>
        <li><b>Bank transfer, {people(bank)}</b> <span className={MUTED}>stay Pending until the ABA file is uploaded to the bank and each is marked paid</span></li>
      </ul>
      {run.stripeConfigured ? null : stripe ? (
        <EToneNotice tone="problem" title="Stripe is not set up on this server">No Stripe key is configured, so every Stripe Connect payout would fail. Nothing is sent until it is set up.</EToneNotice>
      ) : null}
      {failed.map((payout) => (
        <EToneCard key={payout.id} tone="problem" header={<b>{payout.cleanerName || payout.cleanerEmail} · {aud(payout.amount)}</b>} pill="Failed">
          <p className={SMALL}>Failed: &quot;{payout.failureReason || "No reason was recorded."}&quot;</p>
        </EToneCard>
      ))}
      {run.status === "FAILED" ? (
        <p className={SMALL}>
          Fix the failed payout (finish the Stripe set-up or switch to bank transfer), then {isAdmin ? <button type="button" className="font-[600] underline underline-offset-2" onClick={() => open({ kind: "run-status", preset: "CONFIRMED" })}>Set back to Confirmed…</button> : <b>an administrator sets it back to Confirmed</b>} and process again. Paid payouts are skipped, so nobody is paid twice.
        </p>
      ) : null}
      <p className={cn("text-[0.75rem]", MUTED)}>Processing only runs on a Confirmed run, once. A second request is refused while it runs.</p>
    </RailCard>
  );
}

function AbaCard({ run }: { run: PayrollRunView }) {
  const missingBank = run.payouts.filter((payout) => payout.problems.some((problem) => problem.code === "NO_BANK_DETAILS"));
  return (
    <RailCard title="ABA file and who may do what" aria-label="ABA file and roles">
      <p className={SMALL}>
        <b>ABA file</b>{" "}
        {run.abaGeneratedAt
          ? `was made ${stamp(run.abaGeneratedAt, run.timezone)}${run.abaGeneratedByName ? ` by ${run.abaGeneratedByName}` : ""}. A second download asks first, because uploading two could pay people twice.`
          : abaAvailable(run.status)
            ? "has not been made yet."
            : "can be made once the run is confirmed."}
        {missingBank.length ? ` ${missingBank.map((payout) => payout.cleanerName || payout.cleanerEmail).join(", ")} ${missingBank.length === 1 ? "is" : "are"} left out of it until bank details are added.` : ""}
      </p>
      <p className={SMALL}><b>Administrators</b>: everything on this page. <b>Operations managers</b>: confirm, download the ABA file, payslips and single payout status; sending payouts and changing the run&apos;s status are for administrators.</p>
      <p className={SMALL}><b>Testing as someone</b>: Process and Set status manually ask for your own PIN, so they are refused while testing as another account.</p>
    </RailCard>
  );
}

export function PayrollRunPage({ run, role }: { run: PayrollRunView; role: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = React.useState<PayrollDialog>(null);
  const aba = useAbaDownload(run.id);
  const isAdmin = role === "ADMIN";
  const status = run.status as PayrollRunStatusName;
  const period = periodTitleFromDays(run.periodStartDay, run.periodEndDay);
  const stageView = payrollRunStages(run, (iso) => stamp(iso, run.timezone));
  const busy = Boolean(dialog) || aba.busy;
  const primary = payrollPrimaryAction(run.status, isAdmin);
  const adminOnlyHint = primary.kind === "process-admin-only" || primary.kind === "failed-admin-only" ? primary.hint : null;
  const description = [
    people(run.cleanerCount),
    "job pay, shopping and transport",
    `created${run.createdByName ? ` by ${run.createdByName}` : ""} ${stamp(run.createdAt, run.timezone)}`,
    run.confirmedAt ? `confirmed ${clock(run.confirmedAt, run.timezone)}` : null,
  ].filter(Boolean).join(" · ");

  const onDone = (message: string) => {
    setDialog(null);
    toast({ title: message });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Link href={BACK} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← Pay runs</Link>
      <EPageHeader
        title={
          <>
            Pay run, {period}{" "}
            <EPill tone={RUN_TONE[status] ?? "neutral"} className="align-middle font-sans text-[0.75rem]">{PAYROLL_RUN_STATUS_LABEL[status] ?? run.status}</EPill>
          </>
        }
        description={description}
        actions={
          <>
            {abaAvailable(run.status) && primary.kind !== "download-aba" ? (
              <EButton size="sm" variant="outline" className="max-sm:hidden" disabled={aba.busy} onClick={() => void aba.download()}>{aba.busy ? "Generating…" : "Download ABA file"}</EButton>
            ) : null}
            {primaryButton(run, isAdmin, setDialog, aba, busy, "max-sm:hidden")}
            <ERowMenu label="More pay run actions" trigger="More" triggerVariant="outline" items={moreItems(run, isAdmin, setDialog, aba)} disabled={busy} />
          </>
        }
      />
      {adminOnlyHint ? <p id="payroll-admin-only" className={cn(SMALL, MUTED)}>{adminOnlyHint}</p> : null}
      {status === "VOID" ? (
        <EToneNotice tone="info" title="Voided">This run is read only. Payslips still open.</EToneNotice>
      ) : null}
      <EStageBar label="Pay run stages" stages={stageView.stages} terminal={stageView.terminal} />
      <FactTiles label="Pay run totals" tiles={facts(run)} />
      <EToneNotice tone="info">
        Work already on a cleaner invoice is left out of a pay run, so nobody is paid twice.{run.notes ? ` Notes on this run: "${run.notes}"` : ""}
      </EToneNotice>
      <PayoutTable
        run={run}
        actions={{ disabled: busy, onMarkPaid: (payout) => setDialog({ kind: "mark-paid", payout }), onChangeStatus: (payout) => setDialog({ kind: "payout-status", payout }) }}
      />
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <ProcessingCard run={run} isAdmin={isAdmin} open={setDialog} />
        <AbaCard run={run} />
      </div>
      <RailCard title="History" aria-label="Pay run history">
        <HistoryList entries={run.history} timezone={run.timezone} empty="No changes recorded since the run was created." />
      </RailCard>
      <EPhoneActionBar label="Pay run actions" primary={primaryButton(run, isAdmin, setDialog, aba, busy, "h-11 w-full")} hidden={primary.kind === "none"} />
      <PayrollRunDialogs run={run} dialog={dialog} onClose={() => setDialog(null)} onDone={onDone} />
    </div>
  );
}
