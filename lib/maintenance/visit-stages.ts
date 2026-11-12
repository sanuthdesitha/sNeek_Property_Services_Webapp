/**
 * The maintenance visit stage strip (board "Maintenance portal": Accepted, On
 * the way, On site, Finish). Read-only, mapped from recorded timestamps only:
 * "done" needs a recorded fact; an optional step that left no record once a
 * later step happened is "passed", never "done".
 */
import type { EStage } from "@/components/v2/ui/stage-bar";

export interface VisitStageInput {
  status: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  resolvedAt: string | null;
  outcome: string | null;
}

export function visitStages(item: VisitStageInput): EStage[] {
  const finished = Boolean(item.resolvedAt || item.clockOutAt || item.outcome);
  const onSite = Boolean(item.clockInAt || item.arrivedAt);
  const started = Boolean(item.enRouteAt) || onSite || finished;
  const accepted = started || (item.status !== null && item.status !== "OPEN");
  const state = (done: boolean, later: boolean, current: boolean): EStage["state"] =>
    done ? "done" : later ? "passed" : current ? "current" : "todo";
  return [
    { key: "accepted", label: "Accepted", state: state(accepted, started, !accepted) },
    { key: "en-route", label: "On the way", state: state(Boolean(item.enRouteAt), onSite || finished, accepted && !item.enRouteAt) },
    { key: "on-site", label: "On site", state: state(onSite, finished, Boolean(item.enRouteAt) && !onSite) },
    { key: "finish", label: "Finish", state: finished ? "done" : onSite ? "current" : "todo" },
  ];
}
