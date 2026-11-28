"use client";

/**
 * "Looks unused — ask the office" for the assigned cleaner (2026-11-28).
 *
 * UnusedCheckRequest  the body of the job "+" row: the open question or the
 *                     office's answer, and the ask form when asking is allowed.
 * UnusedCheckStatus   the same question and answer inside the job screen, so
 *                     the cleaner sees the office's answer without the menu.
 *
 * Both read GET /api/cleaner/jobs/[id]/unused-check. Obsolete reads are
 * aborted and a response for another job is ignored. The ask draft (note,
 * photos, request key) is kept per job while the sheet is closed and after a
 * failed send, and the same request key is re-sent on retry, so a double tap
 * or a retry never asks twice. The answer never changes the job or pay.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { HelpCircle, Loader2, RefreshCw } from "lucide-react";
import { EAlert, EBadge, EButton } from "@/components/v2/ui/primitives";
import { EField, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";
import {
  UNUSED_CHECK_DECISION_GUIDANCE,
  UNUSED_CHECK_DECISION_LABELS,
  UNUSED_CHECK_NOTE_MAX,
  UNUSED_CHECK_PHOTO_MAX,
  type UnusedCheckCleanerPayload,
  type UnusedCheckView,
} from "@/lib/jobs/unused-check-rules";

/** How often the job screen re-reads while the office has not answered. */
const WAITING_POLL_MS = 30_000;

/**
 * `payload` is the last good read for THIS job (kept when a refresh fails, so
 * a waiting question or an answer never disappears); `error` is the latest
 * failure, cleared by the next good read.
 */
type LoadState = {
  loading: boolean;
  payload: UnusedCheckCleanerPayload | null;
  error: string | null;
};

const INITIAL_STATE: LoadState = { loading: true, payload: null, error: null };

type UnusedCheckDraft = {
  note: string;
  photos: CapturedMedia[];
  /** Kept until the office has the question, so a retry is the same request. */
  requestKey: string;
};

type AskResponse = {
  outcome?: "CREATED" | "REPLAYED" | "ALREADY_OPEN";
  checks?: UnusedCheckView[];
  error?: string;
};

/** Drafts survive closing the "+" sheet; keyed by job so they never cross jobs. */
const drafts = new Map<string, UnusedCheckDraft>();

function newRequestKey(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `unused-${random}`.replace(/[^A-Za-z0-9_-]/g, "");
}

function readDraft(jobId: string): UnusedCheckDraft {
  return drafts.get(jobId) ?? { note: "", photos: [], requestKey: newRequestKey() };
}

function isPayloadFor(value: unknown, jobId: string): value is UnusedCheckCleanerPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<UnusedCheckCleanerPayload>;
  return payload.jobId === jobId && Array.isArray(payload.checks);
}

const DEFAULT_TIME_ZONE = "Australia/Sydney";

/** A time of day in the organisation timezone (from the payload), never the phone's. */
function formatAskedTime(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return formatInTimeZone(date, timeZone, "h:mm a").toLowerCase();
  } catch {
    return formatInTimeZone(date, DEFAULT_TIME_ZONE, "h:mm a").toLowerCase();
  }
}

/** One read of this job's questions, aborted when the job changes or a newer read starts. */
function useUnusedChecks(jobId: string, revision: number) {
  const [state, setState] = React.useState<LoadState>(INITIAL_STATE);
  const controllerRef = React.useRef<AbortController | null>(null);

  const fail = React.useCallback((message: string) => {
    setState((previous) => ({ loading: false, payload: previous.payload, error: message }));
  }, []);

  const load = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((previous) => ({ ...previous, loading: true }));
    try {
      const res = await fetch(`/api/cleaner/jobs/${encodeURIComponent(jobId)}/unused-check`, { cache: "no-store", signal: controller.signal });
      const body: unknown = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const reported = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
        fail(typeof reported === "string" ? reported : "Could not load the office's answer.");
        return;
      }
      if (!isPayloadFor(body, jobId)) {
        fail("Could not load the office's answer.");
        return;
      }
      setState({ loading: false, payload: body, error: null });
    } catch {
      if (controller.signal.aborted) return;
      fail("No connection. The office's answer could not be loaded.");
    }
  }, [jobId, fail]);

  // A new job starts from loading, never from another job's answer.
  React.useEffect(() => {
    setState(INITIAL_STATE);
  }, [jobId]);

  React.useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load, revision]);

  const accept = React.useCallback((payload: UnusedCheckCleanerPayload) => {
    if (payload.jobId === jobId) setState({ loading: false, payload, error: null });
  }, [jobId]);

  return { state, reload: load, accept };
}

function RetryLine({ message, busy, onRetry }: { message: string; busy: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{message}</p>
      <EButton variant="outline" size="sm" disabled={busy} onClick={onRetry}>
        <RefreshCw aria-hidden className="h-4 w-4" /> Try again
      </EButton>
    </div>
  );
}

function CheckCard({ check, timeZone }: { check: UnusedCheckView; timeZone: string }) {
  if (check.status === "WAITING") {
    return (
      <EAlert tone="warning" title="Waiting for the office">
        <p>Do not clean yet. The office has your question{check.askedAt ? ` (asked ${formatAskedTime(check.askedAt, timeZone)})` : ""} and will answer here and in your inbox.</p>
        {check.note ? <p className="mt-1">Your note: “{check.note}”</p> : null}
        {check.photoCount > 0 ? <p className="mt-1">{check.photoCount} photo{check.photoCount === 1 ? "" : "s"} sent.</p> : null}
      </EAlert>
    );
  }
  const decision = check.decision;
  const label = decision ? UNUSED_CHECK_DECISION_LABELS[decision] : "Answered";
  return (
    <EAlert tone={decision === "DO_NOT_CLEAN" ? "danger" : "success"} title={`Office answer: ${label}`}>
      {decision ? <p>{UNUSED_CHECK_DECISION_GUIDANCE[decision]}</p> : null}
      {check.decisionNote ? <p className="mt-1">Note from the office: “{check.decisionNote}”</p> : null}
      <p className="mt-1">
        Asked {formatAskedTime(check.askedAt, timeZone)}
        {check.answeredAt ? ` · answered ${formatAskedTime(check.answeredAt, timeZone)}` : ""}
        {check.note ? ` · your note: “${check.note}”` : ""}
      </p>
    </EAlert>
  );
}

function AskForm({
  jobId,
  timeZone: draftTimeZone,
  onAsked,
}: {
  jobId: string;
  timeZone?: string;
  onAsked: (payload: UnusedCheckCleanerPayload) => void;
}) {
  const [draft, setDraftState] = React.useState<UnusedCheckDraft>(() => readDraft(jobId));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);

  const setDraft = React.useCallback((patch: Partial<UnusedCheckDraft>) => {
    setDraftState((previous) => {
      const next = { ...previous, ...patch };
      drafts.set(jobId, next);
      return next;
    });
  }, [jobId]);

  async function send() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const sentFor = jobId;
    try {
      const res = await fetch(`/api/cleaner/jobs/${encodeURIComponent(sentFor)}/unused-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: draft.requestKey,
          note: draft.note.trim() || null,
          photoKeys: draft.photos.map((photo) => photo.key),
        }),
      });
      const body = (await res.json().catch(() => null)) as AskResponse | null;
      if (!res.ok || !body?.checks) {
        // The draft and its request key stay, so trying again is the same request.
        setError(body?.error ?? "Could not reach the office. Your note is kept; try again.");
        return;
      }
      drafts.delete(sentFor);
      onAsked({ jobId: sentFor, checks: body.checks, canAsk: false, refusal: "The office has not answered yet.", timeZone: draftTimeZone });
    } catch {
      setError("No connection. Your note is kept; try again when you have signal.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Beds untouched, towels unused, bins empty? Do not clean yet. The office is told now and answers here.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <EField label="What you see (optional)">
          <ETextarea
            value={draft.note}
            maxLength={UNUSED_CHECK_NOTE_MAX}
            placeholder="e.g. Beds made, towels folded, no rubbish"
            onChange={(event) => setDraft({ note: event.target.value })}
          />
        </EField>
        <EField label={`Photos (optional, up to ${UNUSED_CHECK_PHOTO_MAX})`}>
          <MediaCapture
            value={draft.photos}
            onChange={(photos) => setDraft({ photos: photos.slice(0, UNUSED_CHECK_PHOTO_MAX) })}
            mode="photo"
            folder="evidence"
            multiple
            stamp={{ tag: "before", contextLabel: "Looks unused" }}
          />
        </EField>
      </fieldset>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <EButton variant="gold" size="sm" disabled={busy} onClick={() => void send()}>
        {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <HelpCircle aria-hidden className="h-4 w-4" />}
        {busy ? "Asking the office…" : "Ask the office"}
      </EButton>
    </div>
  );
}

/** The "+" row body: status of this job's question, and the form when asking is allowed. */
export function UnusedCheckRequest({ jobId, onChanged }: { jobId: string; onChanged?: () => void }) {
  const { state, reload, accept } = useUnusedChecks(jobId, 0);

  if (!state.payload && state.loading) {
    return (
      <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (!state.payload) {
    return <RetryLine message={state.error ?? "Could not load the office's answer."} busy={state.loading} onRetry={() => void reload()} />;
  }

  const { checks, canAsk, refusal } = state.payload;
  const latest = checks[0] ?? null;
  return (
    <div className="space-y-3">
      {latest ? <CheckCard check={latest} timeZone={state.payload.timeZone ?? DEFAULT_TIME_ZONE} /> : null}
      {canAsk ? (
        <AskForm
          key={jobId}
          jobId={jobId}
          timeZone={state.payload.timeZone}
          onAsked={(payload) => {
            accept(payload);
            onChanged?.();
          }}
        />
      ) : refusal && latest?.status !== "WAITING" ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{refusal}</p>
      ) : null}
      {state.error ? <RetryLine message={state.error} busy={state.loading} onRetry={() => void reload()} /> : null}
    </div>
  );
}

/**
 * The question and the office's answer inside the job screen. Shows nothing
 * until this job has a question; re-reads while the office has not answered.
 */
export function UnusedCheckStatus({ jobId, revision }: { jobId: string; revision: number }) {
  const { state, reload } = useUnusedChecks(jobId, revision);
  const waiting = Boolean(state.payload?.checks.some((check) => check.status === "WAITING"));

  React.useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void reload(), WAITING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, reload]);

  const latest = state.payload?.checks[0] ?? null;
  if (!latest) {
    // Nothing asked on this job (or not known yet). A failed first read says so.
    return state.error && !state.loading ? <RetryLine message="Could not check for an answer from the office." busy={false} onRetry={() => void reload()} /> : null;
  }
  return (
    <section aria-label="Looks unused — office answer" className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="e-eyebrow">Looks unused</p>
        <EBadge tone={latest.status === "WAITING" ? "warning" : "neutral"}>{latest.status === "WAITING" ? "Waiting" : "Answered"}</EBadge>
      </div>
      <CheckCard check={latest} timeZone={state.payload?.timeZone ?? DEFAULT_TIME_ZONE} />
      {state.error ? <RetryLine message="Could not refresh. This may not be the latest answer." busy={state.loading} onRetry={() => void reload()} /> : null}
    </section>
  );
}
