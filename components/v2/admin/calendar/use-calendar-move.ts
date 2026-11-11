"use client";

/**
 * One calendar move (drag or "Move or reassign…"):
 *
 *   check  → POST /api/admin/calendar/check-move (read-only)
 *   confirm → the person reads the result and confirms
 *   save   → POST /api/admin/phase4/reschedule/:id/apply (the Schedule tab's
 *            endpoint) and/or POST /api/admin/jobs/:id/assign, exactly as the
 *            server's plan says; nothing else is called.
 *
 * No optimistic success: the chip stays where it is, frozen (`pendingIds`),
 * until the services answer. A refusal or failure leaves it in place and keeps
 * the message on screen until dismissed.
 */
import { useCallback, useMemo, useState } from "react";
import { checkMoveResponseSchema, type CalendarJob, type CheckMoveResponse } from "@/lib/calendar/types";
import { parseReassignPreview, type ReassignPreview } from "@/components/v2/admin/jobs/reassign-note-dialog";

export type MoveRequest = {
  job: CalendarJob;
  toDate: string;
  fromCleanerId: string | null;
  toCleanerId: string | null;
  /** Day view: the start the drop proposes (HH:mm). Omitted: keep the job's times. */
  toStartTime?: string | null;
};

export type MoveState =
  | { phase: "idle" }
  | { phase: "checking"; request: MoveRequest }
  | { phase: "confirm"; request: MoveRequest; check: CheckMoveResponse }
  | { phase: "refused"; request: MoveRequest; reasons: string[] }
  | { phase: "saving"; request: MoveRequest; check: CheckMoveResponse }
  | { phase: "failed"; request: MoveRequest; check: CheckMoveResponse | null; message: string }
  | { phase: "done"; request: MoveRequest; message: string };

export const MOVE_REASON = "Moved on the calendar";

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const parsed: unknown = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {} };
}

function errorText(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
}

export type CalendarMoveApi = {
  state: MoveState;
  pendingIds: ReadonlySet<string>;
  reassignPreview: ReassignPreview | null;
  request: (move: MoveRequest) => Promise<void>;
  confirm: () => Promise<void>;
  dismiss: () => void;
  clearReassignPreview: () => void;
};

export function useCalendarMove(onSaved: () => void): CalendarMoveApi {
  const [state, setState] = useState<MoveState>({ phase: "idle" });
  const [reassignPreview, setReassignPreview] = useState<ReassignPreview | null>(null);

  const request = useCallback(async (move: MoveRequest) => {
    setState({ phase: "checking", request: move });
    try {
      const result = await postJson("/api/admin/calendar/check-move", {
        jobId: move.job.id, toDate: move.toDate, fromCleanerId: move.fromCleanerId, toCleanerId: move.toCleanerId,
        ...(move.toStartTime ? { toStartTime: move.toStartTime } : {}),
      });
      if (!result.ok) {
        setState({ phase: "refused", request: move, reasons: [errorText(result.body, `The move could not be checked (${result.status}).`)] });
        return;
      }
      const check = checkMoveResponseSchema.safeParse(result.body);
      if (!check.success) {
        setState({ phase: "refused", request: move, reasons: ["The move check returned an unexpected response. Nothing was changed."] });
        return;
      }
      if (check.data.blockers.length > 0) setState({ phase: "refused", request: move, reasons: check.data.blockers });
      else setState({ phase: "confirm", request: move, check: check.data });
    } catch {
      setState({ phase: "refused", request: move, reasons: ["The move could not be checked. Check the connection and try again. Nothing was changed."] });
    }
  }, []);

  const confirm = useCallback(async () => {
    if (state.phase !== "confirm") return;
    const { request: move, check } = state;
    setState({ phase: "saving", request: move, check });
    const { reschedule, assign } = check.plan;
    let rescheduled = false;
    try {
      if (reschedule) {
        const result = await postJson(`/api/admin/phase4/reschedule/${encodeURIComponent(move.job.id)}/apply`, {
          date: reschedule.date, expectedUpdatedAt: reschedule.expectedUpdatedAt, reason: MOVE_REASON,
          // Only a time move carries times; otherwise the service keeps the job's own.
          ...(reschedule.startTime !== undefined ? { startTime: reschedule.startTime, dueTime: reschedule.dueTime ?? null } : {}),
        });
        if (!result.ok) {
          setState({ phase: "failed", request: move, check, message: `Not moved: ${errorText(result.body, "the reschedule was refused.")}` });
          return;
        }
        rescheduled = true;
      }
      if (assign) {
        const result = await postJson(`/api/admin/jobs/${encodeURIComponent(move.job.id)}/assign`, {
          userIds: assign.userIds, primaryUserId: assign.primaryUserId ?? undefined,
        });
        if (!result.ok) {
          const reason = errorText(result.body, "the assignment was refused.");
          setState({
            phase: "failed", request: move, check,
            message: rescheduled ? `The date changed, but the cleaner did not: ${reason}` : `Not reassigned: ${reason}`,
          });
          onSaved();
          return;
        }
        const preview = parseReassignPreview(result.body, move.job.id);
        if (preview) setReassignPreview(preview);
      }
      setState({ phase: "done", request: move, message: `${check.propertyName} saved.` });
      onSaved();
    } catch {
      setState({
        phase: "failed", request: move, check,
        message: rescheduled
          ? "The date changed, but the connection failed before the cleaner change. Reload to see what was saved."
          : "The connection failed. Reload to see whether anything was saved before trying again.",
      });
      if (rescheduled) onSaved();
    }
  }, [state, onSaved]);

  const dismiss = useCallback(() => setState({ phase: "idle" }), []);
  const clearReassignPreview = useCallback(() => setReassignPreview(null), []);

  const pendingIds = useMemo<ReadonlySet<string>>(() => {
    if (state.phase === "checking" || state.phase === "confirm" || state.phase === "saving") return new Set([state.request.job.id]);
    return new Set();
  }, [state]);

  return { state, pendingIds, reassignPreview, request, confirm, dismiss, clearReassignPreview };
}
