/**
 * One summary of everything slow that is happening in this tab.
 *
 * Uploads, exports and generated documents used to raise one progress toast
 * per HTTP request, each with an invented percentage. A five-photo batch or a
 * multipart video therefore stacked several bars that all said different
 * things. This module reduces those requests to a single honest sentence and a
 * single fraction: how many whole files or tasks have finished out of how many
 * were started.
 *
 * Pure and framework-free so the counting rules are testable on their own.
 */

import type { EndedBatch, LiveBatch } from "./activity-batches";

export type ActivityRequestKind =
  /** A request that carries one whole file. */
  | "upload-file"
  /** Opens a multipart file; the file stays open until completed or aborted. */
  | "upload-open"
  /** One part of an open multipart file. Activity only, never a unit. */
  | "upload-part"
  /** Finishes one open multipart file. */
  | "upload-complete"
  /** Abandons one open multipart file. */
  | "upload-abort"
  /** Any other slow operation: a report, an invoice, an export. */
  | "task";

export type ActivityRequest = {
  kind: ActivityRequestKind;
  /** Sentence fragment shown while a task runs, e.g. "Preparing report PDF". */
  label: string;
};

export type ActivityState = {
  uploadsStarted: number;
  uploadsDone: number;
  uploadsFailed: number;
  /** Multipart files opened and not yet completed or aborted. */
  uploadsOpen: number;
  tasksStarted: number;
  tasksDone: number;
  tasksFailed: number;
  /** Labels of tasks still running, in start order. */
  runningTasks: string[];
  /** Label of the most recently started task, for the finished summary. */
  lastTaskLabel: string | null;
  /** Tracked HTTP requests currently in flight. */
  inFlight: number;
};

export const EMPTY_ACTIVITY: ActivityState = {
  uploadsStarted: 0,
  uploadsDone: 0,
  uploadsFailed: 0,
  uploadsOpen: 0,
  tasksStarted: 0,
  tasksDone: 0,
  tasksFailed: 0,
  runningTasks: [],
  lastTaskLabel: null,
  inFlight: 0,
};

/** Classifies a same-origin API path, or returns null when it is not tracked. */
export function classifyActivityRequest(
  pathname: string,
  search: URLSearchParams,
  forced: boolean,
): ActivityRequest | null {
  if (pathname.startsWith("/api/uploads/")) {
    const step = pathname.slice("/api/uploads/".length).split("/")[0];
    const label = "Uploading files";
    if (step === "direct" || step === "presign") return { kind: "upload-file", label };
    if (step === "presign-multipart" || step === "resume-multipart") return { kind: "upload-open", label };
    if (step === "part") return { kind: "upload-part", label };
    if (step === "complete-multipart") return { kind: "upload-complete", label };
    if (step === "abort-multipart") return { kind: "upload-abort", label };
    // Reading a stored file (signed access) is not an upload.
    return forced ? { kind: "task", label: "Working on your request" } : null;
  }
  const download = /\/(download|export|pdf)(\/|$)/i.test(pathname) || search.get("download") === "1";
  if (pathname.includes("/api/laundry/reports")) return { kind: "task", label: "Preparing laundry report" };
  if (pathname.includes("/api/reports/")) {
    return { kind: "task", label: download ? "Preparing report PDF" : "Generating report" };
  }
  if (pathname.includes("/api/invoices/") || pathname.includes("/api/cleaner/invoice/")) {
    return { kind: "task", label: download ? "Preparing invoice PDF" : "Generating invoice" };
  }
  if (download) return { kind: "task", label: "Preparing download" };
  return forced ? { kind: "task", label: "Working on your request" } : null;
}

export function activityStarted(state: ActivityState, request: ActivityRequest): ActivityState {
  const next = { ...state, inFlight: state.inFlight + 1 };
  if (request.kind === "upload-file" || request.kind === "upload-open") next.uploadsStarted += 1;
  if (request.kind === "task") {
    next.tasksStarted += 1;
    next.runningTasks = [...state.runningTasks, request.label];
    next.lastTaskLabel = request.label;
  }
  return next;
}

export function activityFinished(
  state: ActivityState,
  request: ActivityRequest,
  succeeded: boolean,
): ActivityState {
  const next = { ...state, inFlight: Math.max(0, state.inFlight - 1) };
  switch (request.kind) {
    case "upload-file":
      if (succeeded) next.uploadsDone += 1;
      else next.uploadsFailed += 1;
      break;
    case "upload-open":
      // A refused allocation never opened a file, but the person did try to
      // upload one, so it stays counted as a started upload that failed.
      if (succeeded) next.uploadsOpen += 1;
      else next.uploadsFailed += 1;
      break;
    case "upload-complete":
      if (state.uploadsOpen > 0) {
        next.uploadsOpen -= 1;
        if (succeeded) next.uploadsDone += 1;
        else next.uploadsFailed += 1;
      }
      break;
    case "upload-abort":
      if (state.uploadsOpen > 0) {
        next.uploadsOpen -= 1;
        next.uploadsFailed += 1;
      }
      break;
    case "task": {
      const index = state.runningTasks.indexOf(request.label);
      next.runningTasks = state.runningTasks.filter((_, position) => position !== index);
      if (succeeded) next.tasksDone += 1;
      else next.tasksFailed += 1;
      break;
    }
    case "upload-part":
      break;
  }
  return next;
}

/** Open multipart files whose transfer went silent are reported, not left spinning. */
export function activityInterrupted(state: ActivityState): ActivityState {
  if (state.uploadsOpen === 0) return state;
  return { ...state, uploadsFailed: state.uploadsFailed + state.uploadsOpen, uploadsOpen: 0 };
}

export function isActivityBusy(state: ActivityState, live: LiveBatch[] = []): boolean {
  return state.inFlight > 0 || state.uploadsOpen > 0 || live.length > 0;
}

/** A finished self-measured batch joins the settled counts. */
export function activityBatchEnded(state: ActivityState, result: EndedBatch): ActivityState {
  return {
    ...state,
    uploadsStarted: state.uploadsStarted + result.done + result.failed,
    uploadsDone: state.uploadsDone + result.done,
    uploadsFailed: state.uploadsFailed + result.failed,
  };
}

/** Live batches viewed as part of the same totals. */
function withLive(state: ActivityState, live: LiveBatch[]): ActivityState {
  if (live.length === 0) return state;
  return live.reduce(
    (view, batch) => ({
      ...view,
      uploadsStarted: view.uploadsStarted + batch.total,
      uploadsDone: view.uploadsDone + batch.done,
      uploadsFailed: view.uploadsFailed + batch.failed,
    }),
    state,
  );
}

export type ActivitySummary = {
  tone: "working" | "success" | "danger";
  message: string;
  /** Finished units and total units; null total means nothing countable yet. */
  finished: number;
  total: number;
  /** A single unit has no meaningful fraction, so the bar animates instead. */
  indeterminate: boolean;
  /** 0–100 for the track, including measured bytes of files still in flight. */
  percent: number;
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function uploadSentence(state: ActivityState): string | null {
  const total = state.uploadsStarted;
  if (total === 0) return null;
  const settled = state.uploadsDone + state.uploadsFailed;
  if (settled >= total) return null;
  if (total === 1) return "Uploading 1 file";
  return `Uploading ${Math.min(settled + 1, total)} of ${total} files`;
}

function taskSentence(state: ActivityState): string | null {
  if (state.runningTasks.length === 0) return null;
  if (state.runningTasks.length === 1) return state.runningTasks[0];
  return `${state.runningTasks.length} tasks in progress`;
}

const TASK_DONE: Record<string, string> = {
  "Preparing laundry report": "Laundry report ready",
  "Preparing report PDF": "Report PDF ready",
  "Generating report": "Report generated",
  "Preparing invoice PDF": "Invoice PDF ready",
  "Generating invoice": "Invoice generated",
  "Preparing download": "Download ready",
  "Working on your request": "Request completed",
};

export function summarizeActivity(
  settled: ActivityState,
  live: LiveBatch[] = [],
): ActivitySummary {
  const state = withLive(settled, live);
  const total = state.uploadsStarted + state.tasksStarted;
  const failed = state.uploadsFailed + state.tasksFailed;
  const finished = state.uploadsDone + state.tasksDone + failed;
  const whole = total > 0 ? Math.round((finished / total) * 100) : 0;

  if (isActivityBusy(settled, live)) {
    const items = live.flatMap((batch) => batch.inFlight);
    const measured = items.some((item) => item.percent !== null);
    const partial = items.reduce((sum, item) => sum + (item.percent ?? 0) / 100, 0);
    const compressing = items.length > 0 && items.every((item) => item.phase === "compressing");
    const upload = compressing
      ? `Preparing ${items.length === 1 ? "video" : `${items.length} videos`} for upload`
      : uploadSentence(state);
    const parts = [upload, taskSentence(state)].filter(Boolean) as string[];
    const base = parts.length ? parts.join(" · ") : "Finishing up";
    const message = failed > 0 ? `${base} · ${failed} failed` : base;
    const percent = total > 0 ? Math.min(99, Math.round(((finished + partial) / total) * 100)) : 0;
    return {
      tone: "working",
      message,
      finished,
      total,
      indeterminate: total <= 1 && !measured,
      percent: measured ? percent : whole,
    };
  }

  if (failed > 0) {
    const uploads = state.uploadsFailed;
    const tasks = state.tasksFailed;
    const fragments: string[] = [];
    if (uploads > 0) {
      fragments.push(
        state.uploadsStarted === 1
          ? "The upload did not finish"
          : `${uploads} of ${state.uploadsStarted} uploads did not finish`,
      );
    }
    if (tasks > 0) {
      fragments.push(
        state.tasksStarted === 1 && state.lastTaskLabel
          ? `${state.lastTaskLabel} failed`
          : `${tasks} ${plural(tasks, "task", "tasks")} failed`,
      );
    }
    return {
      tone: "danger",
      message: `${fragments.join(" · ")}. Check the details and retry.`,
      finished,
      total,
      indeterminate: false,
      percent: 100,
    };
  }

  const fragments: string[] = [];
  if (state.uploadsDone > 0) {
    fragments.push(`${state.uploadsDone} ${plural(state.uploadsDone, "file", "files")} uploaded`);
  }
  if (state.tasksDone === 1 && state.lastTaskLabel) {
    fragments.push(TASK_DONE[state.lastTaskLabel] ?? "Done");
  } else if (state.tasksDone > 1) {
    fragments.push(`${state.tasksDone} tasks completed`);
  }
  return {
    tone: "success",
    message: fragments.length ? fragments.join(" · ") : "Done",
    finished,
    total,
    indeterminate: false,
    percent: 100,
  };
}
