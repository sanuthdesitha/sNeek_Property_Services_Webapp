"use client";

/**
 * AI photo review on the inspection record (board "QualityInspection", right
 * column; board "M-QualityDetail", frame 5). Reads and decides through the
 * EXISTING route, /api/qa/jobs/[id]/photo-review, which keeps every rule:
 * a person selects findings and writes a reason, the expected review and
 * score must still match, one photo deduction per QA review, no deduction over
 * an existing QA issue, invoiced jobs refused, impersonation refused.
 *
 * AI findings are suggestions with a confidence band; "Cannot tell" is its own
 * outcome and never a pass; a finding that cannot be approved is shown
 * disabled with the reason written beside it. Nothing is applied until a
 * person approves it in the tier A dialog.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { toneBandClass, toneMutedClass } from "@/components/v2/ui/tone-band";
import { toast } from "@/hooks/use-toast";
import { ExplainFlagButton } from "@/components/v2/shared/ai-help";
import {
  DEFAULT_DEDUCTION_POINTS,
  proposedPhotoDeduction,
  type PhotoFinding,
  type PhotoObservation,
  type PhotoReviewResult,
} from "@/lib/ai/photo-review-policy";
import { findingBand, findingBlockReason } from "@/lib/quality/ai-finding-eligibility";
import type { InspectionRecord } from "@/lib/quality/inspection-record-types";
import { RecordThumb } from "./record-thumb";

type ReviewSettings = { minConfidence: number; maxScoreContribution: number; minorPoints?: number; majorPoints?: number };
type ReviewDecision = { action: string; deduction?: number; scoreBefore?: number; scoreAfter?: number; reason: string };

export type PhotoReviewPayload = {
  enabled: boolean;
  hasSubmission: boolean;
  canApprove: boolean;
  scoreReview: { id: string; score: number } | null;
  review: {
    id: string;
    status: string;
    error?: string | null;
    reviewedAt?: string | null;
    result: PhotoReviewResult | null;
    settings: ReviewSettings;
    decision?: ReviewDecision | null;
  } | null;
  photos: Array<{ mediaId: string; url: string | null; referenceUrls: Array<string | null> }>;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "refused" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: PhotoReviewPayload };

function isPayload(body: unknown): body is PhotoReviewPayload {
  return Boolean(body) && typeof body === "object" && typeof (body as PhotoReviewPayload).enabled === "boolean";
}

const MUTED = "text-[hsl(var(--e-muted-foreground))]";

/** Re-reads quietly while analysis runs; aborts and ignores a late answer for another job. */
function usePhotoReview(jobId: string) {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [version, setVersion] = React.useState(0);
  const current = React.useRef(jobId);
  current.current = jobId;

  React.useEffect(() => {
    const controller = new AbortController();
    setState((previous) => (previous.kind === "ready" && version > 0 ? previous : { kind: "loading" }));
    fetch(`/api/qa/jobs/${encodeURIComponent(jobId)}/photo-review`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted || current.current !== jobId) return;
        if (response.status === 403) {
          setState({ kind: "refused" });
          return;
        }
        if (!response.ok || !isPayload(body)) {
          const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
          setState({ kind: "error", message: typeof error === "string" && error ? error : "AI photo review could not be loaded." });
          return;
        }
        setState({ kind: "ready", data: body });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) return;
        setState({ kind: "error", message: "AI photo review could not be loaded." });
      });
    return () => controller.abort();
  }, [jobId, version]);

  const running = state.kind === "ready" && Boolean(state.data.review && ["PENDING", "RUNNING"].includes(state.data.review.status));
  React.useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setVersion((value) => value + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [running, state]);

  return { state, reload: React.useCallback(() => setVersion((value) => value + 1), []) };
}

function outcomeOf(observation: PhotoObservation): "meets" | "issue" | "cannot_tell" | "not_checked" {
  if (observation.outcome) return observation.outcome;
  if (observation.assessment === "issue") return "issue";
  if (observation.assessment === "pass") return "meets";
  if (observation.assessment === "inconclusive") return "cannot_tell";
  return "not_checked";
}

function OutcomePill({ outcome }: { outcome: ReturnType<typeof outcomeOf> }) {
  if (outcome === "issue") return <EPill tone="warn">Review suggested issue</EPill>;
  if (outcome === "meets") return <EPill tone="ok">Meets the standard (suggestion)</EPill>;
  if (outcome === "cannot_tell") {
    return <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-[hsl(var(--e-border-strong))] px-2.5 py-0.5 text-[0.6875rem] font-semibold">Cannot tell</span>;
  }
  return <EPill>Not checked</EPill>;
}

function findingMeta(finding: PhotoFinding, blocked: string | null): string {
  const parts = [finding.severity === "major" ? "Major" : "Minor", `${findingBand(finding)} confidence`];
  if (finding.referenceMediaKey) parts.push("compared with a reference photo");
  if (blocked) parts.push(blocked);
  return parts.join(" · ");
}

function ObservationCard({
  observation,
  photo,
  jobId,
  selected,
  locked,
  blockReason,
  onToggle,
}: {
  observation: PhotoObservation;
  photo: PhotoReviewPayload["photos"][number] | undefined;
  jobId: string;
  selected: readonly string[];
  locked: boolean;
  blockReason: (finding: PhotoFinding) => string | null;
  onToggle: (findingId: string, on: boolean) => void;
}) {
  const outcome = outcomeOf(observation);
  const located = observation.findings.some((finding) => finding.region);
  return (
    <li className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-[0.875rem] font-[600] [overflow-wrap:anywhere]">{observation.fieldLabel}</p>
        <OutcomePill outcome={outcome} />
      </div>
      {outcome === "issue" && photo ? (
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <RecordThumb url={photo.url} label="Submitted" alt={`Submitted photo, ${observation.fieldLabel}`} />
            {photo.url
              ? observation.findings.map((finding, index) =>
                  finding.region ? (
                    <span
                      key={finding.id}
                      aria-hidden
                      className="pointer-events-none absolute rounded-[2px] border-2 border-[hsl(var(--e-warning))]"
                      style={{ left: `${finding.region.x * 100}%`, top: `${finding.region.y * 100}%`, width: `${finding.region.width * 100}%`, height: `${finding.region.height * 100}%` }}
                    >
                      <span className="absolute -left-0.5 -top-4 rounded bg-[hsl(var(--e-surface))] px-1 text-[0.625rem] font-semibold">{index + 1}</span>
                    </span>
                  ) : null,
                )
              : null}
          </div>
          {photo.referenceUrls.map((url, index) => (
            <RecordThumb key={index} url={url} label={`Reference ${index + 1}`} alt={`Reference ${index + 1} for ${observation.fieldLabel}`} />
          ))}
        </div>
      ) : null}
      {observation.findings.map((finding, index) => {
        const blocked = blockReason(finding);
        const disabled = locked || blocked !== null;
        return (
          <div key={finding.id} className={cn("rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-2.5 py-2", disabled ? "bg-[hsl(var(--e-muted)/0.6)]" : "bg-[hsl(var(--e-surface))]")}>
            <label className="flex min-h-11 items-start gap-2.5 text-[0.8125rem]">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]"
                checked={selected.includes(finding.id)}
                disabled={disabled}
                onChange={(event) => onToggle(finding.id, event.target.checked)}
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="block">
                  {located ? `${index + 1}. ` : ""}
                  {finding.description}
                </span>
                <span className={cn("block text-[0.75rem]", MUTED)}>{findingMeta(finding, blocked)}</span>
              </span>
            </label>
            <ExplainFlagButton jobId={jobId} kind="finding" id={finding.id} label="Explain this finding" />
          </div>
        );
      })}
      {outcome === "cannot_tell" ? (
        <div className="text-[0.8125rem]">
          <p>{observation.reason || observation.summary || "The photo could not be judged."}</p>
          <ExplainFlagButton jobId={jobId} kind="photo" id={observation.mediaId} label="Explain this result" />
        </div>
      ) : null}
      {outcome === "not_checked" ? <p className={cn("text-[0.8125rem]", MUTED)}>{observation.reason || "No reference photo or acceptance criteria on this question."}</p> : null}
    </li>
  );
}

export function RecordAiReview({ record, canManage }: { record: InspectionRecord; canManage: boolean }) {
  const router = useRouter();
  const { state, reload } = usePhotoReview(record.jobId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  const data = state.kind === "ready" ? state.data : null;
  const review = data?.review ?? null;
  const reviewId = review?.id ?? null;
  // A different analysis is a different decision: start again.
  React.useEffect(() => {
    setSelected([]);
    setError(null);
  }, [reviewId]);

  const observations = review?.result?.observations ?? [];
  const findings = observations.flatMap((observation) => observation.findings);
  const settings = review?.settings;
  const points = { minor: settings?.minorPoints ?? DEFAULT_DEDUCTION_POINTS.minor, major: settings?.majorPoints ?? DEFAULT_DEDUCTION_POINTS.major };
  const deduction = settings ? proposedPhotoDeduction(findings, selected, settings.minConfidence, settings.maxScoreContribution, points) : 0;
  const decided = Boolean(review?.reviewedAt);
  const ready = review?.status === "READY" && !decided;
  const canDecide = Boolean(ready && canManage && data?.canApprove && data.scoreReview);
  const scoreBefore = data?.scoreReview?.score ?? null;
  const scoreAfter = scoreBefore === null ? null : Math.max(0, Math.round((scoreBefore - deduction) * 100) / 100);

  const blockReason = React.useCallback(
    (finding: PhotoFinding) =>
      settings && reviewId
        ? findingBlockReason(finding, {
            minConfidence: settings.minConfidence,
            coveredFieldIds: record.ai.coveredFieldIds,
            coveredMediaIds: record.ai.coveredMediaIds,
            analysisId: reviewId,
            deductedAnalysisIds: record.ai.deductedAnalysisIds,
          })
        : null,
    [settings, reviewId, record.ai],
  );

  async function act(action: "analyze" | "approve" | "dismiss"): Promise<boolean> {
    if (saving || !data) return false;
    setSaving(true);
    setError(null);
    try {
      const body =
        action === "analyze"
          ? { action }
          : {
              action,
              analysisId: review?.id,
              reason: reason.trim(),
              ...(action === "approve" ? { findingIds: selected, expectedReviewId: data.scoreReview?.id, expectedScore: data.scoreReview?.score } : {}),
            };
      const response = await fetch(`/api/qa/jobs/${encodeURIComponent(record.jobId)}/photo-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = result && typeof result === "object" ? (result as { error?: unknown }).error : null;
        throw new Error(typeof message === "string" && message && message !== "FORBIDDEN" ? message : "You cannot make this decision here.");
      }
      if (action === "approve") toast({ title: `Deduction approved · score ${scoreAfter ?? "updated"}` });
      if (action === "dismiss") toast({ title: "Suggestions dismissed; no score change" });
      reload();
      router.refresh();
      return true;
    } catch (cause) {
      setError(`It was not recorded: ${cause instanceof Error ? cause.message : "the request failed."}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const checkedCount = review?.result ? review.result.observations.filter((item) => outcomeOf(item) !== "not_checked").length : 0;
  const notChecked = review?.result ? review.result.observations.filter((item) => outcomeOf(item) === "not_checked").length : 0;

  return (
    <section id="record-ai" aria-labelledby="record-ai-title" className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className={cn("space-y-1 px-4 py-3", toneBandClass("info"))}>
        <div className="flex items-start justify-between gap-2">
          <h2 id="record-ai-title" className="text-[0.9375rem] font-[650]">
            AI photo review
          </h2>
          {review?.result ? (
            <span className="inline-flex shrink-0 rounded-full bg-[hsl(var(--e-surface))] px-2.5 py-0.5 text-[0.6875rem] font-semibold">
              {checkedCount} of {review.result.totalPhotos} checked
            </span>
          ) : null}
        </div>
        <p className={cn("text-[0.8125rem]", toneMutedClass("info"))}>
          Suggestions only. Compared with the form&apos;s reference photos. Nothing changes the score until a person approves.
        </p>
      </div>
      <div className="space-y-3 p-4">
        {state.kind === "loading" ? <p role="status" className={cn("text-[0.875rem]", MUTED)}>Loading AI photo review…</p> : null}
        {state.kind === "refused" ? <p className="text-[0.875rem]">AI photo review is not available to you on this inspection.</p> : null}
        {state.kind === "error" ? (
          <p role="alert" className="text-[0.875rem]">
            {state.message}{" "}
            <button type="button" className="underline" onClick={reload}>
              Try again
            </button>
          </p>
        ) : null}
        {data && !data.enabled ? (
          <p className="text-[0.875rem]">
            Automatic comparison is off. An admin can turn it on in{" "}
            <a className="underline" href="/v2/admin/ai">
              AI configuration
            </a>
            . Photo checks still show under the evidence.
          </p>
        ) : null}
        {data && !data.hasSubmission ? <p className="text-[0.875rem]">No cleaner form has been submitted yet.</p> : null}
        {data && data.enabled && data.hasSubmission && (!review || review.status === "FAILED") ? (
          <div className="space-y-2">
            {review?.status === "FAILED" ? <p className="text-[0.875rem]">The analysis failed{review.error ? `: ${review.error}` : "."} This is not a result.</p> : null}
            {canManage ? (
              <EButton size="sm" variant="outline" disabled={saving} onClick={() => void act("analyze")}>
                {review ? "Retry analysis" : "Analyze submitted photos"}
              </EButton>
            ) : null}
          </div>
        ) : null}
        {review && ["PENDING", "RUNNING"].includes(review.status) ? (
          <p role="status" className="text-[0.875rem]">
            {review.result?.observations.length ?? 0} of {review.result?.totalPhotos ?? "the"} photos checked; this updates by itself.
          </p>
        ) : null}
        {review?.result && notChecked > 0 ? (
          <p className={cn("text-[0.8125rem]", MUTED)}>
            {notChecked} {notChecked === 1 ? "photo" : "photos"} not checked: their question has no reference photo or acceptance criteria. &quot;Cannot tell&quot; is never a pass.
          </p>
        ) : null}
        {observations.length ? (
          <ul className="space-y-2">
            {observations.map((observation) => (
              <ObservationCard
                key={observation.mediaId}
                observation={observation}
                photo={data?.photos.find((photo) => photo.mediaId === observation.mediaId)}
                jobId={record.jobId}
                selected={selected}
                locked={!canDecide || saving}
                blockReason={blockReason}
                onToggle={(id, on) => setSelected((value) => (on ? [...value, id] : value.filter((item) => item !== id)))}
              />
            ))}
          </ul>
        ) : null}
        {review?.decision ? (
          <div role="status" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
            <p className="font-[600]">
              {review.decision.action === "approve"
                ? `Approved deduction: ${review.decision.deduction} points (${review.decision.scoreBefore} → ${review.decision.scoreAfter}).`
                : "Suggestions dismissed; no score change."}
            </p>
            <p className="[overflow-wrap:anywhere]">{review.decision.reason}</p>
          </div>
        ) : null}
        {ready ? (
          <fieldset disabled={saving || !canManage} className="space-y-2 border-t border-[hsl(var(--e-border))] pt-3">
            <legend className="sr-only">Decide on the suggestions</legend>
            {!canManage ? (
              <p className="text-[0.8125rem]">Read-only: you cannot decide on suggestions.</p>
            ) : !data?.scoreReview ? (
              <p className="text-[0.8125rem]">Complete QA scoring first; suggestions are approved against the QA score.</p>
            ) : !data.canApprove ? (
              <p className="text-[0.8125rem]">You cannot approve deductions on this inspection; you can dismiss the suggestions.</p>
            ) : (
              <p className="flex flex-wrap justify-between gap-2 text-[0.8125rem]">
                <span>
                  Selected: <strong>{deduction} points</strong> · QA score {scoreBefore} → {scoreAfter}
                </span>
                <span className={MUTED}>cap {settings?.maxScoreContribution} points</span>
              </p>
            )}
            <label className="block text-[0.8125rem] font-[600]">
              Review reason, required
              <textarea
                className="mt-1 block min-h-20 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-2 text-[0.875rem] font-normal max-sm:text-[16px]"
                value={reason}
                maxLength={2000}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {error && !confirming ? (
              <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 max-sm:grid max-sm:grid-cols-2">
              <EButton variant="outline" size="sm" disabled={saving || reason.trim().length < 3} onClick={() => void act("dismiss")}>
                Dismiss suggestions
              </EButton>
              <EButton size="sm" disabled={saving || !canDecide || deduction <= 0 || reason.trim().length < 3} onClick={() => setConfirming(true)}>
                <span className="sm:hidden">{`Approve ${deduction} ${deduction === 1 ? "point" : "points"}…`}</span>
                <span className="max-sm:hidden">{`Approve ${deduction}-point deduction…`}</span>
              </EButton>
            </div>
          </fieldset>
        ) : null}
      </div>

      <EConfirmDialog
        open={confirming}
        onClose={() => {
          if (!saving) setConfirming(false);
        }}
        tier="ordinary"
        title={`Take ${deduction} points off this clean?`}
        description={`${record.propertyName}${record.jobNumber ? ` ${record.jobNumber}` : ""} goes from ${scoreBefore ?? "its score"} to ${scoreAfter ?? "the new score"}. Your reason is recorded with the decision. No money changes.`}
        confirmLabel="Approve deduction"
        busy={saving}
        error={confirming ? error : null}
        onConfirm={async () => {
          const ok = await act("approve");
          if (ok) setConfirming(false);
        }}
      />
    </section>
  );
}
