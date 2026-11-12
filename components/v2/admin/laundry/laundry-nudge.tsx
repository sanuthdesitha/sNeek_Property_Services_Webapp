"use client";

/**
 * On-demand laundry requests on the lane cards and in the run side panel,
 * shown only where lib/laundry/nudge-rules.ts says the run calls for them
 * (board "Suppliers", lower half: "Pickup and drop questions go to the
 * laundry partner"):
 *
 * - to the laundry partner's team: "Ask laundry team: confirm pickup", "…:
 *   move pickup", "…: drop time", "…: when will it be back?", "Ask laundry
 *   team for photo" (to the team member who delivered when known). Disabled,
 *   with the reason, when the partner has no linked laundry portal users;
 *   "Chase supplier" (./laundry-supplier-chase.tsx) then stands in.
 * - to the cleaner only about the bags they leave out: "Ask cleaner: bags out?".
 *
 * Under each button a line says who it goes to, as drawn. The dialog
 * (./laundry-request-dialog.tsx) states transports and the receipt states.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import {
  NUDGE_LABELS,
  TEAM_REQUEST_LABELS,
  laundryNudgeKinds,
  laundryTeamRequestKinds,
  teamRequestBlockedReason,
  teamRequestToLine,
  type LaundryNudgeKind,
  type LaundryTeamRequestKind,
} from "@/lib/laundry/nudge-rules";
import { LaundryRequestDialog } from "./laundry-request-dialog";
import type { RunPanelTask } from "./laundry-run-panel";

export const LAUNDRY_NUDGE_ENDPOINT = "/api/admin/notifications/actions/laundry-nudge";
export const LAUNDRY_TEAM_REQUEST_ENDPOINT = "/api/admin/notifications/actions/laundry-team-request";

/** One request a run offers: who it goes to, and why it is disabled (null = can be sent). */
export type LaundryRequestOption =
  | { audience: "cleaner"; kind: LaundryNudgeKind; disabledReason: null }
  | { audience: "team"; kind: LaundryTeamRequestKind; disabledReason: string | null };

export function nudgeKindsForTask(task: RunPanelTask, todayKey: string | undefined): LaundryNudgeKind[] {
  if (!todayKey || !task.exceptions) return [];
  return laundryNudgeKinds({
    status: task.status,
    pickupDate: task.pickupDate,
    exceptions: task.exceptions,
    readiness: task.readiness ?? null,
    jobStatus: task.job?.status ?? null,
    hasJob: Boolean(task.jobId),
  }, todayKey);
}

export function teamRequestKindsForTask(task: RunPanelTask, todayKey: string | undefined): LaundryTeamRequestKind[] {
  if (!todayKey || !task.exceptions) return [];
  return laundryTeamRequestKinds({
    status: task.status,
    pickupDate: task.pickupDate,
    dropoffDate: task.dropoffDate,
    exceptions: task.exceptions,
    readiness: task.readiness ?? null,
    jobStatus: task.job?.status ?? null,
    hasJob: Boolean(task.jobId),
    hasSupplier: Boolean(task.supplier),
  }, todayKey);
}

/** The team request the run calls for when nobody on the partner's team can be asked (Chase supplier stands in). */
export function unansweredTeamRequestFor(task: RunPanelTask, todayKey: string | undefined): LaundryTeamRequestKind | null {
  if (!task.supplierTeam || task.supplierTeam.count > 0) return null;
  return teamRequestKindsForTask(task, todayKey)[0] ?? null;
}

export function requestOptionsForTask(task: RunPanelTask, todayKey: string | undefined): LaundryRequestOption[] {
  // Without the team summary (an older payload) nothing is known about the team: say so instead of guessing.
  const teamReason = task.supplierTeam === undefined ? "The laundry team could not be checked. Reload the Pipeline." : teamRequestBlockedReason(task.supplierTeam);
  return [
    ...teamRequestKindsForTask(task, todayKey).map((kind): LaundryRequestOption => ({ audience: "team", kind, disabledReason: teamReason })),
    ...nudgeKindsForTask(task, todayKey).map((kind): LaundryRequestOption => ({ audience: "cleaner", kind, disabledReason: null })),
  ];
}

/**
 * The lane card shows what the board draws: the most pressing team request
 * and the cleaner's bag question. Over turnaround shows "Chase supplier"
 * instead of the return-time request (the run panel still offers both).
 */
export function compactRequestOptions(all: LaundryRequestOption[], chaseOffered: boolean): LaundryRequestOption[] {
  const team = all.filter((option) => option.audience === "team" && !(chaseOffered && option.kind === "TEAM_RETURN_ETA"));
  const cleaner = all.find((option) => option.audience === "cleaner");
  return [team[0], cleaner].filter((option): option is LaundryRequestOption => Boolean(option));
}

export function requestLabel(option: LaundryRequestOption) {
  return option.audience === "team" ? TEAM_REQUEST_LABELS[option.kind] : NUDGE_LABELS[option.kind];
}

/** The drawn "To …" line under the card's buttons. */
export function requestToLine(task: RunPanelTask, options: LaundryRequestOption[]): string | null {
  const team = options.find((option): option is Extract<LaundryRequestOption, { audience: "team" }> => option.audience === "team");
  const cleaner = options.find((option) => option.audience === "cleaner");
  const cleanerNames = task.cleaners?.length ? task.cleaners.join(", ") : "the cleaner";
  if (team && cleaner) return `Bags: ${cleanerNames} · pickup: ${task.supplierTeam?.supplierName ?? "laundry partner"}`;
  if (team) return teamRequestToLine(team.kind, task.supplierTeam ?? null);
  if (cleaner) return `To ${cleanerNames}`;
  return null;
}

type ActionsProps = {
  task: RunPanelTask;
  todayKey: string | undefined;
  /** Lane cards show the most pressing team request and the cleaner request only. */
  compact?: boolean;
  /** Lane cards: Chase supplier is shown, so the return-time request stays in the panel. */
  chaseOffered?: boolean;
};

/** The request buttons for a run (nothing when none applies), their "To" line and dialog. */
export function LaundryNudgeActions({ task, todayKey, compact = false, chaseOffered = false }: ActionsProps) {
  const all = requestOptionsForTask(task, todayKey);
  const options = compact ? compactRequestOptions(all, chaseOffered) : all;
  const [open, setOpen] = React.useState<LaundryRequestOption | null>(null);
  const reasonId = React.useId();
  // A different run closes the dialog.
  React.useEffect(() => setOpen(null), [task.id]);
  if (options.length === 0) return null;
  const blocked = options.find((option) => option.disabledReason);
  const toLine = requestToLine(task, options);
  return (
    <>
      {options.map((option, index) => (
        <EButton
          key={`${option.audience}:${option.kind}`}
          size="sm"
          variant={compact && index === 0 && option.audience === "team" && option.kind === "TEAM_CONFIRM_PICKUP" ? "primary" : "outline"}
          className="h-auto min-h-8 whitespace-normal text-left"
          disabled={Boolean(option.disabledReason)}
          aria-describedby={option.disabledReason ? reasonId : undefined}
          title={option.disabledReason ?? undefined}
          onClick={() => setOpen(option)}
        >
          {requestLabel(option).button}
        </EButton>
      ))}
      {toLine && !blocked ? <span className="basis-full text-[0.6875rem] text-[hsl(var(--e-info,var(--e-primary)))]">{toLine}</span> : null}
      {blocked ? <span id={reasonId} className="basis-full text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{blocked.disabledReason}</span> : null}
      {open ? <LaundryRequestDialog key={`${task.id}:${open.audience}:${open.kind}`} task={task} option={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
