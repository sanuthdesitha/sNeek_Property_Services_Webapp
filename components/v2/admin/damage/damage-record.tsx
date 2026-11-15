"use client";

/**
 * Damage report record page (board "Damage report", approved 2026-11-14),
 * built like the Maintenance item page: back link, one heading with the
 * status and the highest severity, Download PDF, the ONE primary decision and
 * More ▾; a progress strip; six fact tiles; the items as cards with History
 * beneath on the left; Your decision, Tell the client, What the client will
 * see and Linked records on the right.
 *
 * Every change goes through the existing damage route (PATCH
 * /api/admin/damage/[reportId]): estimates (SET_COST), release, take back,
 * close and reopen (REVIEW), send back (VOID, tier C with the own PIN). The
 * release message is new and goes through the notification pipeline with
 * the transports ticked here (owner default: inbox and email, SMS off).
 *
 * Phones: the stage strip swipes, the figures fold, History, What the client
 * will see and Linked records fold, More is a sheet and the primary decision
 * docks at the bottom. Nothing is ever deleted.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { CollapsibleFigures } from "@/components/v2/ui/collapsible-figures";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { toast } from "@/hooks/use-toast";
import { PhoneActionSheet } from "@/components/v2/admin/phone-action-sheet";
import { PhoneCarousel } from "@/components/v2/admin/phone-carousel";
import { cn } from "@/lib/utils";
import { damageRecordStages, estimateCoverageText } from "@/lib/damage/record-model";
import { DEFAULT_RELEASE_TRANSPORTS, type DamageReleaseTransport } from "@/lib/damage/release-notice-types";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";
import { patchDamageRecord, readDamageRecord, readReleaseNotice, type DamageRecordData, type ReleaseNoticeResult } from "./damage-record-api";
import { SEVERITY_LABEL, STATUS_LABEL, dayOnly, dayTime, money, newIdempotencyKey, severityPillTone, statusPillTone, titleText, weekdayTime, zoneLabel } from "./damage-record-format";
import { DamageItemCard } from "./damage-record-items";
import { ClientViewCard, DecisionCard, HistoryCard, LinkedRecordsCard, TellClientCard, decisionModel, transportAvailability, type DecisionKey, type NoticeState } from "./damage-record-rail";
import { ClientPreviewDialog, OrdinaryDecisionDialog, SendBackDialog, ordinaryCopy, type VoidMode } from "./damage-record-dialogs";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; data: DamageRecordData | null }
  | { status: "ready"; data: DamageRecordData };

function useDamageRecord(reportId: string, revision: number): LoadState {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  React.useEffect(() => {
    const controller = new AbortController();
    readDamageRecord(reportId, controller.signal)
      .then((data) => {
        // Checked after parsing: a late answer for another report never fills this one.
        if (controller.signal.aborted || data.report.id !== reportId) return;
        setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "The damage report could not be loaded.";
        setState((current) => ({ status: "error", message, data: current.status === "ready" ? current.data : current.status === "error" ? current.data : null }));
      });
    return () => controller.abort();
  }, [reportId, revision]);
  return state;
}

function useReleaseNotice(reportId: string, enabled: boolean, revision: number): NoticeState {
  const [state, setState] = React.useState<NoticeState>({ status: "loading" });
  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    readReleaseNotice(reportId, controller.signal)
      .then((notice) => {
        if (!controller.signal.aborted) setState({ status: "ready", notice });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "The client message could not be prepared." });
      });
    return () => controller.abort();
  }, [reportId, enabled, revision]);
  return state;
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2">
      <dt className="text-[0.6875rem] font-[500] text-[hsl(var(--e-muted-foreground))]">{label}</dt>
      <dd className="e-tnum text-[0.875rem] font-[600] [overflow-wrap:anywhere]">{value}</dd>
      {sub ? <dd className="text-[0.71875rem] text-[hsl(var(--e-text-secondary))] [overflow-wrap:anywhere]">{sub}</dd> : null}
    </div>
  );
}

/** The page outline while loading or when the report cannot be opened: never "No items". */
function RecordShell({ jobHref, jobLabel, state, onRetry }: { jobHref: string; jobLabel: string; state: LoadState; onRetry: () => void }) {
  const error = state.status === "error" ? state.message : null;
  return (
    <div className="space-y-4">
      <p className="text-[0.8125rem]"><Link href={jobHref} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← {jobLabel}</Link></p>
      <h1 className="e-display-md">{error ? "Damage report" : "Loading the damage report…"}</h1>
      {error ? (
        <div role="alert" className="space-y-2 text-[0.875rem]">
          <p>{error}</p>
          <EButton size="sm" variant="outline" onClick={onRetry}>Try again</EButton>
        </div>
      ) : (
        <div role="status" aria-label="Loading" className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-[58px] animate-pulse rounded-[10px] bg-[hsl(var(--e-surface-raised))]" />)}
          </div>
          <div className="flex flex-col gap-3.5 lg:flex-row">
            <div className="h-48 flex-1 animate-pulse rounded-[12px] bg-[hsl(var(--e-surface-raised))]" />
            <div className="h-48 animate-pulse rounded-[12px] bg-[hsl(var(--e-surface-raised))] lg:w-[340px]" />
          </div>
        </div>
      )}
    </div>
  );
}

export function DamageRecordPage({ reportId, timeZone, jobId, jobNumber }: { reportId: string; timeZone: string; jobId: string | null; jobNumber: string | null }) {
  const phone = useIsPhone();
  const [revision, setRevision] = React.useState(0);
  const state = useDamageRecord(reportId, revision);
  const data = state.status === "ready" ? state.data : state.status === "error" ? state.data : null;
  const [busy, setBusy] = React.useState(false);
  const [choice, setChoice] = React.useState<DecisionKey | null>(null);
  const [pending, setPending] = React.useState<DecisionKey | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [sendBackOpen, setSendBackOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [transports, setTransports] = React.useState<DamageReleaseTransport[]>([...DEFAULT_RELEASE_TRANSPORTS]);
  const releaseKey = React.useRef<string | null>(null);
  const [lastNotice, setLastNotice] = React.useState<ReleaseNoticeResult | null>(null);
  const releasable = Boolean(data && !data.report.clientVisible && data.report.status !== "DRAFT" && data.report.status !== "CLOSED");
  const notice = useReleaseNotice(reportId, releasable, revision);

  // Unavailable transports are never ticked: an inbox message must not silently become nothing either.
  React.useEffect(() => {
    if (notice.status !== "ready") return;
    const availability = transportAvailability(notice.notice);
    setTransports((current) => current.filter((transport) => !availability[transport]));
  }, [notice]);

  const reload = React.useCallback(() => setRevision((value) => value + 1), []);
  const jobHref = jobId ? `/v2/admin/jobs/${encodeURIComponent(jobId)}` : "/v2/admin/cases";
  const jobLabel = jobId ? `Job ${jobNumber ?? ""}`.trim() : "Cases";

  if (!data) return <RecordShell jobHref={jobHref} jobLabel={jobLabel} state={state} onRetry={reload} />;

  const { report, context } = data;
  const model = decisionModel(report, context);
  const caseCount = report.items.filter((item) => item.caseId).length;
  const severities = report.items.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.severity]: (counts[item.severity] ?? 0) + 1 }), {});
  const severityLine = ["SEVERE", "MAJOR", "MODERATE", "MINOR"].filter((key) => severities[key]).map((key) => `${severities[key]} ${(SEVERITY_LABEL[key] ?? key).toLowerCase()}`).join(" · ") || "No items";
  const latestVoid = report.voids[0] ?? null;
  const releasedAudit = context.lastRelease?.at ?? null;
  const stages = damageRecordStages(
    {
      status: report.status,
      firstSubmittedAt: context.firstSubmittedAt,
      submittedAt: report.submittedAt,
      voids: report.voids,
      clientVisible: report.clientVisible,
      reviewedByName: report.reviewedByName,
      reviewedAt: report.reviewedAt,
      releasedAt: releasedAudit,
      acknowledgedAt: report.acknowledgedAt,
      acknowledgedName: report.acknowledgedName,
      closedAt: report.status === "CLOSED" ? report.reviewedAt : null,
    },
    (iso) => (iso ? weekdayTime(iso, timeZone) : null),
  );
  const subLine = [
    `${report.items.length} item${report.items.length === 1 ? "" : "s"}`,
    `reported by ${report.reportedByName ?? "a cleaner"} from ${context.job.jobNumber ?? "the job"} ${titleText(context.job.jobType).toLowerCase()}, ${dayOnly(context.job.scheduledDate, timeZone) ?? "date not recorded"}`,
    report.voids.length > 0 && report.submittedAt ? `resubmitted ${dayTime(report.submittedAt, timeZone)}` : null,
    context.client?.name ?? "no client",
    report.clientVisible ? "released to the client" : "not released to the client",
  ].filter(Boolean).join(" · ");

  async function run(work: () => Promise<{ notice: ReleaseNoticeResult | null }>, success: string): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      const result = await work();
      if (result.notice) setLastNotice(result.notice);
      toast({ title: success, description: result.notice?.error ?? undefined, variant: result.notice?.error ? "destructive" : undefined });
      reload();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "It was not recorded.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openDecision(key: DecisionKey) {
    setActionError(null);
    if (key === "send-back") {
      setSendBackOpen(true);
      return;
    }
    if (key === "release" && !releaseKey.current) releaseKey.current = newIdempotencyKey("release");
    setPending(key);
  }

  async function confirmOrdinary() {
    const key = pending;
    if (!key) return;
    const ok = await run(() => {
      switch (key) {
        case "release":
          return patchDamageRecord(reportId, { action: "REVIEW", release: true, ...(transports.length ? { notice: { transports, idempotencyKey: releaseKey.current ?? newIdempotencyKey("release") } } : {}) });
        case "take-back":
          return patchDamageRecord(reportId, { action: "REVIEW", release: false });
        case "close":
          return patchDamageRecord(reportId, { action: "REVIEW", release: false, close: true });
        case "close-released":
          return patchDamageRecord(reportId, { action: "REVIEW", release: true, close: true });
        default:
          return patchDamageRecord(reportId, { action: "REVIEW", release: report.clientVisible });
      }
    }, key === "release" ? "Released to the client" : key === "take-back" ? "Taken back from the client" : key === "reopen" ? "Reopened for review" : "Closed");
    if (ok) {
      if (key === "release") releaseKey.current = null;
      setPending(null);
      setChoice(null);
    }
  }

  async function confirmSendBack(mode: VoidMode, reason: string, security: SensitiveCredentialsInput | undefined) {
    const ok = await run(() => patchDamageRecord(reportId, { action: "VOID", mode, reason, security: (security ?? {}) as Record<string, unknown> }), "Sent back to the cleaner");
    if (ok) setSendBackOpen(false);
  }

  async function saveEstimate(itemId: string, value: number | null): Promise<string | null> {
    try {
      await patchDamageRecord(reportId, { action: "SET_COST", itemId, estimatedCost: value });
      reload();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "It was not saved.";
    }
  }

  const primaryKey = model.options[0]?.key ?? null;
  const primary = primaryKey ? (
    <EButton type="button" disabled={busy} onClick={() => openDecision(primaryKey)} aria-haspopup="dialog">{model.confirmLabel[primaryKey]}</EButton>
  ) : null;
  const canSendBack = report.status !== "DRAFT";
  const moreItems: ERowMenuItem[] = [
    { key: "preview", heading: "Report", label: "Preview as the client", onSelect: () => setPreviewOpen(true) },
    ...(releasable ? [{ key: "close", label: "Close without releasing…", badge: "kept internal", onSelect: () => openDecision("close") }] : []),
    { key: "pdf", label: "Download PDF", href: `/api/damage/${encodeURIComponent(reportId)}/report`, newTab: true },
    {
      key: "copy",
      label: "Copy link",
      onSelect: () => {
        void navigator.clipboard?.writeText(window.location.href).then(
          () => toast({ title: "Link copied" }),
          () => toast({ title: "The link could not be copied", variant: "destructive" }),
        );
      },
    },
    ...(canSendBack ? [{ key: "send-back", heading: "Back to the cleaner", separated: true, label: "Send back to the cleaner…", badge: "your PIN, a reason", onSelect: () => openDecision("send-back") }] : []),
  ];
  const moreFootnote = "No delete. Sending back archives the answers or reopens them; photos and every earlier version stay.";
  const copy = pending ? ordinaryCopy(pending, { clientName: context.client?.name ?? null, caseCount, transports: pending === "release" ? transports : [] }) : null;
  const zone = zoneLabel(timeZone);

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem]">
              <Link href={`/v2/admin/jobs/${encodeURIComponent(context.job.id)}`} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← Job {context.job.jobNumber ?? ""}</Link>
              <span className="font-mono text-[hsl(var(--e-muted-foreground))] max-sm:hidden"> · /v2/admin/damage/{report.id.slice(0, 5)}…</span>
            </p>
            <h1 className="e-display-md mt-1 break-words">
              Damage at {context.property.name}{" "}
              <EPill tone={statusPillTone(report.status, report.clientVisible)} className="align-middle [font-family:var(--e-font-sans)] tracking-normal">{STATUS_LABEL[report.status] ?? titleText(report.status)}</EPill>{" "}
              {report.highestSeverity ? <EPill tone={severityPillTone(report.highestSeverity)} className="align-middle [font-family:var(--e-font-sans)] tracking-normal">{SEVERITY_LABEL[report.highestSeverity] ?? report.highestSeverity}</EPill> : null}
            </h1>
            <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{subLine}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EButton asChild variant="outline" className="max-sm:hidden">
              <a href={`/api/damage/${encodeURIComponent(reportId)}/report`} target="_blank" rel="noreferrer">Download PDF</a>
            </EButton>
            <span className="max-sm:hidden">{primary}</span>
            {phone ? (
              <EButton size="icon" variant="outline" aria-label="More: preview as the client, close, copy link, send back" onClick={() => setMoreOpen(true)}>⋯</EButton>
            ) : (
              <ERowMenu label="More actions for this damage report" trigger="More ▾" triggerVariant="outline" items={moreItems} footnote={moreFootnote} />
            )}
          </div>
        </div>

        {state.status === "error" ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
            <span className="min-w-0 flex-1">Showing the last copy loaded; it could not be refreshed: {state.message}</span>
            <EButton size="sm" variant="outline" onClick={reload}>Try again</EButton>
          </div>
        ) : null}

        <PhoneCarousel label="Progress, swipe for more">
          <EStageBar label="Progress" stages={stages} className="max-sm:flex max-sm:w-max max-sm:[&>li]:min-w-[8rem]" />
        </PhoneCarousel>

        <CollapsibleFigures storageKey="damage-record" count={6} label="figures">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <Fact label="Reported by" value={report.reportedByName ?? "Not recorded"} sub={<>Cleaner · from <Link className="underline" href={`/v2/admin/jobs/${encodeURIComponent(context.job.id)}`}>{context.job.jobNumber ?? "the job"}</Link></>} />
            <Fact label="Items" value={report.items.length} sub={severityLine} />
            <Fact label="Our repair estimate" value={money(context.estimate.total) ?? "Not estimated"} sub={`${estimateCoverageText(context.estimate)} · internal`} />
            <Fact label="Client can see it" value={report.clientVisible ? "Yes" : "No"} sub={`report and its ${caseCount} case${caseCount === 1 ? "" : "s"} ${report.clientVisible ? "in their portal" : "hidden"}`} />
            <Fact
              label="Client acknowledged"
              value={report.acknowledgedAt ? `"${report.acknowledgedName ?? "the client"}"` : "Not yet"}
              sub={report.acknowledgedAt ? dayTime(report.acknowledgedAt, timeZone) : report.clientVisible ? "waiting for the client" : "after release"}
            />
            <Fact
              label="PDF check code"
              value={context.verification ? <span className="font-mono">{context.verification.code}</span> : "Not issued"}
              sub={context.verification ? `${context.verification.revoked ? "revoked · " : ""}issued ${dayOnly(context.verification.issuedAt, timeZone)}` : "made with the first PDF"}
            />
          </dl>
        </CollapsibleFigures>
      </header>

      <div className="flex min-w-0 flex-col gap-3.5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {report.status === "DRAFT" ? (
            <p role="status" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
              Sent back {latestVoid ? dayTime(latestVoid.voidedAt, timeZone) : ""}{latestVoid?.voidedByName ? ` by ${latestVoid.voidedByName}` : ""}: &ldquo;{latestVoid?.reason ?? "no reason recorded"}&rdquo;. The cleaner is correcting it; nothing can be decided until it is resubmitted.
            </p>
          ) : null}
          {report.items.length === 0 ? (
            <p className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              {report.status === "DRAFT" ? "The answers were cleared for the cleaner to start again; the earlier ones are archived with the send-back." : "This report has no items."}
            </p>
          ) : null}
          {report.items.map((item, index) => (
            <DamageItemCard
              key={item.id}
              item={item}
              index={index}
              timeZone={timeZone}
              clientVisible={report.clientVisible}
              earlierReports={context.earlierReportsAtProperty}
              frozen={busy}
              onSaveEstimate={saveEstimate}
            />
          ))}
          <HistoryCard context={context} timeZone={timeZone} zone={zone} />
        </div>
        <aside aria-label="Decision and links" className="flex min-w-0 flex-col gap-3 lg:w-[340px] lg:shrink-0">
          <DecisionCard report={report} context={context} timeZone={timeZone} model={model} choice={choice} busy={busy} onChoice={setChoice} onConfirm={openDecision} />
          {lastNotice && (lastNotice.outcomes.length > 0 || lastNotice.error) ? (
            <p role="status" className={cn("rounded-[var(--e-radius)] border px-3 py-2 text-[0.8125rem]", lastNotice.error ? "border-[hsl(var(--e-danger)/0.4)] text-[hsl(var(--e-danger))]" : "border-[hsl(var(--e-border))]")}>
              {lastNotice.error ?? `Client message: ${lastNotice.outcomes.map((outcome) => `${outcome.name} ${outcome.transport.toLowerCase().replace("_", " ")} ${outcome.state.replace(/_/g, " ")}`).join(", ")}. Not proof it was read.`}
            </p>
          ) : null}
          {releasable ? (
            <TellClientCard
              state={notice}
              transports={transports}
              busy={busy}
              onToggle={(transport, on) => {
                releaseKey.current = null;
                setTransports((current) => (on ? Array.from(new Set([...current, transport])) : current.filter((value) => value !== transport)));
              }}
              onRetry={reload}
            />
          ) : null}
          <ClientViewCard caseCount={report.items.length} onPreview={() => setPreviewOpen(true)} />
          <LinkedRecordsCard report={report} context={context} timeZone={timeZone} />
        </aside>
      </div>

      <EPhoneActionBar label="Damage report actions" primary={primary ?? <EButton type="button" variant="outline" onClick={() => setPreviewOpen(true)}>Preview as the client</EButton>} />
      {phone ? <PhoneActionSheet open={moreOpen} onOpenChange={setMoreOpen} title="Damage report" items={moreItems} footnote={moreFootnote} /> : null}

      <OrdinaryDecisionDialog decision={pending} copy={copy} busy={busy} error={actionError} onClose={() => { setPending(null); setActionError(null); }} onConfirm={confirmOrdinary} />
      <SendBackDialog open={sendBackOpen} cleanerName={report.reportedByName} busy={busy} error={sendBackOpen ? actionError : null} onClose={() => { setSendBackOpen(false); setActionError(null); }} onConfirm={confirmSendBack} />
      <ClientPreviewDialog reportId={reportId} open={previewOpen} onClose={() => setPreviewOpen(false)} />
    </div>
  );
}
