"use client";

/**
 * Laundry run full page (board LaundryRunDetail). Composes the existing run
 * panel pieces (requests, Chase supplier, planned times, team answers, photo
 * replacement, Edit, Reschedule, Skip or delete, the run report) with the new
 * Change state and Void tools. Every action re-reads the page afterwards
 * (router.refresh), so the page always shows the stored run.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EStageBar, type EStage, type EStageState } from "@/components/v2/ui/stage-bar";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EPhoneActionBar, ESectionSwitcher } from "@/components/v2/ui/phone-bars";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EPill } from "@/components/v2/ui/pill";
import { toast } from "@/hooks/use-toast";
import { useLaundryDeleteDialog, type LaundryDeletePayload } from "@/components/v2/laundry/laundry-delete-dialog";
import { primaryRunAction, runOffTrack, runStageStates, RUN_STAGES, type RunPrimaryActionKey } from "@/lib/laundry/run-page-rules";
import { stateName } from "@/lib/laundry/run-correction-rules";
import type { RunPageExtras, RunViewer } from "@/lib/laundry/run-page-types";
import type { LaundryTeamRequestKind } from "@/lib/laundry/nudge-rules";
import { LaundryNudgeActions, requestOptionsForTask } from "../laundry-nudge";
import { LaundryRequestDialog } from "../laundry-request-dialog";
import { LaundrySupplierChase, chaseAppliesToTask } from "../laundry-supplier-chase";
import { LaundryPlannedTimes } from "../laundry-planned-times";
import { LaundryTeamReplies } from "../laundry-team-replies";
import { LaundryEvidenceReplacement } from "../laundry-evidence-replacement";
import { LaundryEditDialog } from "../laundry-edit-dialog";
import { LaundryMoveDialog, type MoveReport, type MoveTarget } from "../laundry-move";
import { dayWithTime } from "../laundry-lane-card";
import type { RunPanelTask } from "../laundry-run-panel";
import type { LaundryTaskDTO } from "../laundry-shared";
import { CorrectionsList, FailedPickupTable, HandoffBody, NotRecorded, RunHistory, RunPhotos, RunRail, RunStage, StageButton } from "./run-sections";
import { RunChangeStateDialog, type ChangeStateRun } from "./run-change-state-dialog";
import { RunUndoVoidDialog, RunVoidDialog, type VoidRun } from "./run-void-dialogs";

type RunTask = RunPanelTask & { voidedAt?: string | null };

type Props = {
  task: RunTask;
  extras: RunPageExtras;
  viewer: RunViewer;
  skipReasons: Array<{ value: string; label: string }>;
};

type Tab = "timeline" | "photos" | "requests" | "history";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "timeline", label: "Timeline" },
  { key: "photos", label: "Photos" },
  { key: "requests", label: "Requests and replies" },
  { key: "history", label: "History" },
];

const STAGE_MAP: Record<"done" | "now" | "todo" | "stuck", EStageState> = { done: "done", now: "current", todo: "todo", stuck: "pending" };

function statusPill(task: RunTask, extras: RunPageExtras): { tone: "bad" | "warn" | "ok" | "info" | "neutral"; label: string } {
  if (extras.voided) return { tone: "neutral", label: "Voided" };
  if (task.status === "FLAGGED") return { tone: "bad", label: "Flagged" };
  if (task.status === "SKIPPED_PICKUP") return { tone: "neutral", label: "Skipped" };
  if (task.status === "DROPPED") return { tone: "ok", label: "Dropped off" };
  if (task.exceptions?.length) return { tone: "warn", label: task.exceptions[0].label };
  return { tone: "info", label: stateName(task.status) };
}

function versionOf(task: RunTask): string {
  return task.updatedAt ?? new Date(0).toISOString();
}

export function LaundryRunPage({ task, extras, viewer, skipReasons }: Props) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>("timeline");
  const [changeRuns, setChangeRuns] = React.useState<ChangeStateRun[] | null>(null);
  const [voidRuns, setVoidRuns] = React.useState<VoidRun[] | null>(null);
  const [undoRun, setUndoRun] = React.useState<VoidRun | null>(null);
  const [editTask, setEditTask] = React.useState<LaundryTaskDTO | null>(null);
  const [moveTargets, setMoveTargets] = React.useState<MoveTarget[] | null>(null);
  const [requestKind, setRequestKind] = React.useState<LaundryTeamRequestKind | null>(null);
  const [decideOpen, setDecideOpen] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const refresh = React.useCallback(() => router.refresh(), [router]);

  // A different run resets every open dialog.
  React.useEffect(() => {
    setChangeRuns(null); setVoidRuns(null); setUndoRun(null); setEditTask(null); setMoveTargets(null); setRequestKind(null); setDecideOpen(false); setTab("timeline");
  }, [task.id]);

  const name = task.property?.name ?? "Laundry run";
  const voided = Boolean(extras.voided);
  const pill = statusPill(task, extras);
  const reference = `R-${task.id.slice(-6).toUpperCase()}`;
  const options = requestOptionsForTask(task, viewer.todayKey);
  const openTeamKinds = options.filter((option) => option.audience === "team" && !option.disabledReason).map((option) => option.kind as LaundryTeamRequestKind);
  const primary = primaryRunAction({
    status: task.status,
    voided,
    pendingSkipRequest: Boolean(extras.pendingSkipRequest),
    exceptionCodes: (task.exceptions ?? []).map((item) => item.code),
    teamRequestKinds: openTeamKinds,
    canChase: chaseAppliesToTask(task, viewer.todayKey),
    canUndoVoid: viewer.canVoid,
    canChangeState: viewer.canChangeState && !voided,
  });
  const stages: EStage[] = runStageStates({ status: task.status, pickedUpAt: task.pickedUpAt ?? null, droppedAt: task.droppedAt ?? null, failedPickups: extras.failedPickups.length })
    .map((state, index) => ({ key: RUN_STAGES[index], label: RUN_STAGES[index], state: STAGE_MAP[state], note: state === "stuck" ? `${extras.failedPickups.length} tr${extras.failedPickups.length === 1 ? "y" : "ies"} failed` : null }));
  const offTrack = runOffTrack({ status: task.status, voided });

  const changeRun: ChangeStateRun = { taskId: task.id, expectedUpdatedAt: versionOf(task), name, status: task.status, pickedUpAt: task.pickedUpAt ?? null, droppedAt: task.droppedAt ?? null, onEmailedReport: Boolean(extras.emailedReport) };
  const voidRun: VoidRun = { taskId: task.id, expectedUpdatedAt: versionOf(task), name, status: task.status };
  const moveTarget: MoveTarget | null = task.updatedAt ? { id: task.id, name, updatedAt: task.updatedAt } : null;
  const done = task.status === "DROPPED" || task.status === "SKIPPED_PICKUP";

  async function downloadReport() {
    setDownloading(true);
    try {
      const response = await fetch("/api/laundry/invoice/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: task.id }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "The run report could not be made.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `laundry-run-${task.id}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      toast({ title: "No report", description: cause instanceof Error ? cause.message : "The run report could not be made.", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  function openReschedule() {
    if (moveTarget) setMoveTargets([moveTarget]);
  }

  const removeTask = React.useCallback(async (target: { id: string }, payload: LaundryDeletePayload) => {
    const response = await fetch(`/api/laundry/${target.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      toast({ title: "Could not delete", description: body.error ?? "The laundry run could not be removed.", variant: "destructive" });
      return false;
    }
    if (payload.mode === "PERMANENT") router.push("/v2/admin/laundry");
    else refresh();
    return true;
  }, [refresh, router]);
  const { requestDelete, modal: deleteModal } = useLaundryDeleteDialog(removeTask);

  function runPrimary(key: RunPrimaryActionKey) {
    switch (key) {
      case "UNDO_VOID": setUndoRun(voidRun); break;
      case "DECIDE_SKIP_REQUEST": setDecideOpen(true); break;
      case "ASK_TEAM_CONFIRM_PICKUP": setRequestKind("TEAM_CONFIRM_PICKUP"); break;
      case "ASK_TEAM_RETURN": setRequestKind("TEAM_RETURN_ETA"); break;
      case "ASK_TEAM_DROP_TIME": setRequestKind("TEAM_CONFIRM_DROP"); break;
      case "ASK_TEAM_PHOTO": setRequestKind("TEAM_PHOTO"); break;
      case "CHASE_SUPPLIER": document.getElementById("s-laundry")?.scrollIntoView({ behavior: "smooth", block: "start" }); break;
      case "CHANGE_STATE": setChangeRuns([changeRun]); break;
      case "DOWNLOAD_REPORT": void downloadReport(); break;
    }
  }

  const voidItem: ERowMenuItem = viewer.canVoid
    ? extras.voidable
      ? { key: "void", label: "Void this run…", danger: true, badge: "Admin · PIN", onSelect: () => setVoidRuns([voidRun]) }
      : { key: "void", label: "Void this run…", danger: true, disabled: true, hint: voided ? "Already voided" : "Only skipped or flagged runs, or failed pickups still waiting, can be voided" }
    : { key: "void", label: "Void this run…", danger: true, disabled: true, hint: viewer.voidBlockedReason ?? "Voiding is for administrators" };
  const menu: ERowMenuItem[] = [
    { key: "edit", heading: "Run", label: "Edit run details", disabled: voided, hint: voided ? "Undo the void first" : undefined, onSelect: () => setEditTask(task) },
    { key: "reschedule", label: "Reschedule pickup or drop-off", disabled: done || voided || !moveTarget, hint: done ? "Delivered or skipped runs have nothing to move" : undefined, onSelect: openReschedule },
    { key: "change", label: "Change state…", disabled: !viewer.canChangeState || voided, hint: voided ? "Undo the void first" : !viewer.canChangeState ? "Your access does not include correcting a run" : undefined, onSelect: () => setChangeRuns([changeRun]) },
    { key: "report", label: downloading ? "Making the run report…" : "Download run report (PDF)", disabled: downloading, onSelect: () => void downloadReport() },
    { key: "panel", label: "Open in Pipeline side panel", href: `/v2/admin/laundry?open=${encodeURIComponent(task.id)}` },
    { key: "copy", label: "Copy link to this run", onSelect: () => void navigator.clipboard?.writeText(`${window.location.origin}/v2/admin/laundry/runs/${task.id}`).then(() => toast({ title: "Link copied" }), () => toast({ title: "Copy the link from the address bar", variant: "destructive" })) },
    { key: "skip", heading: "Danger zone", separated: true, label: "Skip or delete…", danger: true, disabled: voided, hint: voided ? "A voided run keeps its record" : undefined, onSelect: () => requestDelete(task as never) },
    voided
      ? { key: "undo", label: "Undo void…", disabled: !viewer.canVoid, hint: viewer.voidBlockedReason ?? undefined, badge: "Admin · PIN", onSelect: () => setUndoRun(voidRun) }
      : voidItem,
  ];

  const sections = [
    { id: "s-timeline", label: "Timeline" },
    { id: "r-partner", label: "Partner" },
    { id: "r-property", label: "Property" },
    { id: "r-job", label: "Job" },
    { id: "r-money", label: "Money" },
    { id: "r-exceptions", label: "Exceptions" },
    { id: "r-history", label: "History" },
  ];

  const primaryButton = (
    <EButton onClick={() => runPrimary(primary.key)} disabled={downloading && primary.key === "DOWNLOAD_REPORT"}>{primary.label}</EButton>
  );
  const pickupTone = task.status === "FLAGGED" || extras.failedPickups.length > 0 ? "problem" : task.exceptions?.some((item) => item.code === "PICKUP_OVERDUE") ? "attention" : null;
  const atLaundry = task.status === "PICKED_UP" || task.status === "READY_TO_RETURN";

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.8125rem]"><Link href="/v2/admin/laundry" className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← Laundry</Link> <span className="text-[hsl(var(--e-muted-foreground))]">· {reference}</span></p>
            <h1 className="e-display-md mt-1 break-words">{name} · {reference} <EPill tone={pill.tone} className="align-middle">{pill.label}</EPill></h1>
            <p className="mt-1 text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
              Laundry run for {task.job ? `clean ${task.job.jobNumber ?? ""}${task.job.scheduledDate ? `, ${dayWithTime(task.job.scheduledDate, null)}` : ""}` : "no linked clean"}
              {task.property?.client?.name ? ` · ${task.property.client.name}` : ""}
              {task.supplier?.name ? ` · ${task.supplier.name}` : " · no laundry partner recorded"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!voided && viewer.canChangeState ? <EButton variant="outline" className="max-sm:hidden" onClick={() => setChangeRuns([changeRun])}>Change state…</EButton> : null}
            <span className="max-sm:hidden">{primaryButton}</span>
            <ERowMenu label={`More actions for ${name}`} trigger="More ▾" triggerVariant="outline" items={menu} footnote="Void, Undo void and Delete permanently ask for your own PIN." />
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
          <EStageBar label="Run stages" className="flex-1" stages={stages} terminal={voided ? { title: "Voided", description: `${extras.voided?.when ?? ""}${extras.voided?.who ? ` by ${extras.voided.who}` : ""}. Was ${extras.voided?.previousStatus ?? "not recorded"}.` } : null} />
          <div role="group" aria-label="Off-track states" className="flex flex-wrap gap-1.5">
            {(["FLAGGED", "SKIPPED", "VOIDED"] as const).map((state) => (
              <span key={state} aria-current={offTrack === state ? "true" : undefined} className={`inline-flex items-center rounded-[var(--e-radius)] border px-2.5 py-1.5 text-[0.75rem] font-semibold ${offTrack === state ? "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger))] text-white" : "border-dashed border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))]"}`}>
                {state === "FLAGGED" ? "Flagged" : state === "SKIPPED" ? "Skipped" : "Voided"}
              </span>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {[
            ["Bags out", task.bagCount ? String(task.bagCount) : null],
            ["Bags back", task.droppedAt ? "Delivered" : task.pickedUpAt ? "At the laundry" : "Not picked up"],
            ["Planned pickup", dayWithTime(task.pickupDate, task.pickupTime ?? null)],
            ["Planned drop-off", dayWithTime(task.dropoffDate, task.dropoffTime ?? null)],
            ["At the laundry", task.dayOf ? `Day ${task.dayOf.day} of ${task.dayOf.planned}` : atLaundry ? "Day not known" : "Not started"],
            ["Weight", task.bagWeightKg != null ? `${task.bagWeightKg} kg` : null],
            ["Cost", task.dropoffCostAud != null ? `$${Number(task.dropoffCostAud).toFixed(2)}` : null],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2">
              <dt className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{label}</dt>
              <dd className="text-[0.875rem] font-semibold tabular-nums">{value ?? <NotRecorded />}</dd>
            </div>
          ))}
        </dl>
        {voided ? (
          <EToneNotice tone="info" title={`Voided ${extras.voided?.when ?? ""}${extras.voided?.who ? ` by ${extras.voided.who}` : ""}`}>
            <p>{extras.voided?.reason}</p>
            <p>The run is left out of every list, count and report. Its record, photos and history are kept here.</p>
          </EToneNotice>
        ) : extras.pendingSkipRequest || task.exceptions?.length ? (
          <EToneNotice tone="problem" title="This run needs you">
            <ul className="list-disc pl-4">
              {extras.pendingSkipRequest ? <li>{extras.pendingSkipRequest.who ?? "The laundry team"} asked the office to approve a {extras.pendingSkipRequest.requestedAction === "DELETE" ? "delete" : "skip"} ({extras.pendingSkipRequest.when})</li> : null}
              {(task.exceptions ?? []).map((item) => <li key={item.code}>{item.label}</li>)}
              {extras.nextClean && !task.droppedAt ? <li>Next clean {extras.nextClean.jobNumber ?? ""} {extras.nextClean.when} needs this linen</li> : null}
            </ul>
          </EToneNotice>
        ) : null}
      </header>

      <ESectionSwitcher label="Run sections" sections={sections} />

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        <section id="s-timeline" aria-label="Run" className="min-w-0 flex-1 space-y-3">
          <div role="tablist" aria-label="Run views" className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--e-border))]">
            {TABS.map((item) => (
              <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className={`min-h-11 whitespace-nowrap border-b-2 px-3 text-[0.8125rem] sm:min-h-9 ${tab === item.key ? "border-[hsl(var(--e-primary))] font-semibold text-[hsl(var(--e-primary))]" : "border-transparent text-[hsl(var(--e-muted-foreground))]"}`}>
                {item.label}{item.key === "history" ? ` ${extras.history.length}` : item.key === "requests" ? ` ${(task.teamReplies ?? []).length}` : ""}
              </button>
            ))}
          </div>

          {tab === "timeline" ? (
            <div className="space-y-3">
              <CorrectionsList extras={extras} />
              <RunStage id="s-handoff" number={1} name="Cleaner handoff" state={extras.handoffWhen ? "done" : "todo"} title={extras.handoffWhen ? "Linen reported" : "Not reported yet"}
                actions={task.jobId ? <Link className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline" href={`/v2/admin/jobs/${task.jobId}`}>Open the clean</Link> : null}>
                <HandoffBody task={task} extras={extras} />
              </RunStage>

              <RunStage id="s-pickup" number={2} name="Pickup" tone={pickupTone} state={task.pickedUpAt ? "done" : voided || task.status === "SKIPPED_PICKUP" ? "todo" : "now"}
                title={task.pickedUpAt ? `Picked up ${extras.pickupWhen ?? ""}` : extras.failedPickups.length ? `${extras.failedPickups.length} failed pickup${extras.failedPickups.length === 1 ? "" : "s"}` : `Planned ${dayWithTime(task.pickupDate, task.pickupTime ?? null)}`}
                actions={!voided && !done ? <LaundryNudgeActions task={task} todayKey={viewer.todayKey} /> : null}>
                <div className="space-y-2.5">
                  <FailedPickupTable extras={extras} />
                  <p className="text-[0.8125rem]">Bags picked up: {task.pickedUpAt && task.bagCount ? task.bagCount : <NotRecorded />}. A count different from the cleaner's needs a reason and a photo and goes to office review.</p>
                  {!done && !voided ? <LaundryPlannedTimes key={task.id} task={task} onSaved={refresh} /> : null}
                  {extras.pendingSkipRequest ? (
                    <EToneNotice tone="problem" title={`${extras.pendingSkipRequest.who ?? "The laundry team"} asked the office to approve a ${extras.pendingSkipRequest.requestedAction === "DELETE" ? "delete" : "skip"}`}>
                      {extras.pendingSkipRequest.reason ? <p>"{extras.pendingSkipRequest.reason}"</p> : null}
                      <div className="mt-2 flex flex-wrap gap-2"><EButton size="sm" onClick={() => setDecideOpen(true)}>Decide skip request</EButton><span className="text-[0.75rem]">Also in Approvals. Deciding here closes it there.</span></div>
                    </EToneNotice>
                  ) : null}
                </div>
              </RunStage>

              <RunStage id="s-laundry" number={3} name="At the laundry" state={atLaundry ? "now" : task.droppedAt ? "done" : "todo"}
                title={atLaundry ? (task.dayOf ? `Day ${task.dayOf.day} of ${task.dayOf.planned}` : "At the laundry") : task.droppedAt ? "Washed" : "Not started"}
                actions={!voided ? <LaundrySupplierChase task={task} todayKey={viewer.todayKey} /> : null}>
                <div className="space-y-2 text-[0.8125rem]">
                  <p>Weight {task.bagWeightKg != null ? `${task.bagWeightKg} kg` : <NotRecorded />} · price {task.dropoffCostAud != null ? `$${Number(task.dropoffCostAud).toFixed(2)}` : <NotRecorded />}. Figures the laundry team enters show "Entered by" in the Pipeline side panel until the office edits them.</p>
                  <LaundryTeamReplies replies={task.teamReplies} />
                </div>
              </RunStage>

              <RunStage id="s-ready" number={4} name="Ready to return" state={task.status === "READY_TO_RETURN" ? "now" : task.droppedAt ? "done" : "todo"}
                title={task.status === "READY_TO_RETURN" ? "Marked ready by the laundry team" : task.droppedAt ? "Done" : "Not yet"}>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Optional: a run can go straight from pickup to drop-off.</p>
              </RunStage>

              <RunStage id="s-drop" number={5} name="Drop-off" state={task.droppedAt ? "done" : "todo"}
                title={task.droppedAt ? `Dropped off ${extras.droppedWhen ?? ""}` : `Planned ${dayWithTime(task.dropoffDate, task.dropoffTime ?? null)}`}>
                <p className="text-[0.8125rem]">Drop photos and receipts are in the Photos tab. A photo the team adds after delivery is kept as its own record.</p>
              </RunStage>

              <RunStage id="s-invoice" number={6} name="Invoice" state={extras.invoiceLine.state === "emailed" ? "done" : "todo"} title={extras.invoiceLine.label}
                actions={<Link className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline" href="/v2/admin/laundry?tab=costs">Costs and invoices</Link>}>
                <p className="text-[0.8125rem]">{extras.invoiceLine.detail}</p>
              </RunStage>
            </div>
          ) : null}
          {tab === "photos" ? (
            <ECard className="space-y-3 p-3.5">
              <RunPhotos task={task} />
              {!voided && (task.confirmations ?? []).some((row) => row.photoUrl) ? (
                <div className="space-y-1.5">
                  <p className="e-eyebrow">Replace a photo</p>
                  {(task.confirmations ?? []).filter((row) => row.photoUrl).map((row) => <LaundryEvidenceReplacement key={row.id} confirmationId={row.id} onSaved={refresh} />)}
                </div>
              ) : null}
            </ECard>
          ) : null}
          {tab === "requests" ? (
            <ECard className="space-y-3 p-3.5">
              {!voided ? <div className="flex flex-wrap gap-1.5"><LaundryNudgeActions task={task} todayKey={viewer.todayKey} /><LaundrySupplierChase task={task} todayKey={viewer.todayKey} /></div> : null}
              {(task.teamReplies ?? []).length ? <LaundryTeamReplies replies={task.teamReplies} /> : <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No answers from the laundry team on this run.</p>}
            </ECard>
          ) : null}
          {tab === "history" ? <ECard className="p-3.5"><RunHistory entries={extras.history} /></ECard> : null}
        </section>
        <RunRail task={task} extras={extras} />
      </div>

      <EPhoneActionBar label="Run actions" primary={primaryButton} secondary={!voided && viewer.canChangeState && primary.key !== "CHANGE_STATE" ? <EButton variant="outline" onClick={() => setChangeRuns([changeRun])}>Change state…</EButton> : undefined} />

      <RunChangeStateDialog runs={changeRuns} doneByOptions={extras.doneByOptions} skipReasons={skipReasons} handoffWhen={extras.handoffWhen} timeZone={viewer.timeZone}
        onClose={() => setChangeRuns(null)}
        onSaved={() => { setChangeRuns(null); toast({ title: "Correction saved", description: "History shows it as an office correction." }); refresh(); }} />
      <RunVoidDialog runs={voidRuns} emailedReport={extras.emailedReport}
        nextCleanNote={extras.nextClean && !task.droppedAt ? `Next clean ${extras.nextClean.jobNumber ?? ""}, ${extras.nextClean.when}, still needs linen.` : null}
        onClose={() => setVoidRuns(null)}
        onDone={(outcomes) => { setVoidRuns(null); const failed = outcomes.find((item) => !item.ok); toast(failed ? { title: "Not voided", description: failed.message, variant: "destructive" } : { title: "Run voided", description: "Undo void is in the More menu." }); refresh(); }} />
      <RunUndoVoidDialog run={undoRun} previousState={extras.voided?.previousStatus ?? null} onClose={() => setUndoRun(null)} onDone={() => { setUndoRun(null); toast({ title: "Void undone" }); refresh(); }} />
      {requestKind ? (
        <LaundryRequestDialog key={`${task.id}:${requestKind}`} task={task} option={{ audience: "team", kind: requestKind, disabledReason: null }} onClose={() => { setRequestKind(null); refresh(); }} />
      ) : null}
      <SkipDecisionDialog open={decideOpen} task={task} request={extras.pendingSkipRequest} onClose={() => setDecideOpen(false)} onDone={() => { setDecideOpen(false); refresh(); }} />
      <LaundryMoveDialog targets={moveTargets} defaultDate={task.pickupDate.slice(0, 10)} onClose={() => setMoveTargets(null)} onMoved={(result: MoveReport) => { setMoveTargets(null); toast({ title: result.moved ? "Moved" : "Not moved", description: result.refused.map((row) => row.reason).join(" ") || undefined }); refresh(); }} />
      <LaundryEditDialog task={editTask} onClose={() => setEditTask(null)} onSaved={refresh} />
      {deleteModal}
    </div>
  );
}

/** The existing failed-pickup decision (PATCH action), from the run page. */
function SkipDecisionDialog({ open, task, request, onClose, onDone }: {
  open: boolean;
  task: RunTask;
  request: RunPageExtras["pendingSkipRequest"];
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (!open) { setNote(""); setError(null); } }, [open]);
  if (!open || !request) return null;
  async function decide(action: "APPROVE_FAILED_PICKUP_SKIP" | "APPROVE_FAILED_PICKUP_DELETE" | "REJECT_FAILED_PICKUP_REQUEST") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/laundry/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, resolutionNotes: note.trim() || null }) });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Not decided. Try again.");
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not decided. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const approve = request.requestedAction === "DELETE" ? "APPROVE_FAILED_PICKUP_DELETE" : "APPROVE_FAILED_PICKUP_SKIP";
  return (
    <EActionDialog open eyebrow="Decide skip request" title={task.property?.name ?? "Laundry run"} description={`${request.who ?? "The laundry team"} asked to ${request.requestedAction === "DELETE" ? "delete" : "skip"} this run (${request.when}).`} busy={busy} onClose={onClose}
      footer={
        <>
          <EButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton variant="outline" onClick={() => void decide("REJECT_FAILED_PICKUP_REQUEST")} disabled={busy}>Reject, back to the previous state</EButton>
          <EButton onClick={() => void decide(approve)} disabled={busy}>{request.requestedAction === "DELETE" ? "Approve delete" : "Approve skip"}</EButton>
        </>
      }>
      <fieldset disabled={busy} className="space-y-2">
        {request.reason ? <p className="text-[0.8125rem]">"{request.reason}"</p> : null}
        <label className="block text-[0.75rem] font-semibold">Note, optional<input className="mt-1 h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:h-9 sm:text-[0.875rem]" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      </fieldset>
    </EActionDialog>
  );
}
