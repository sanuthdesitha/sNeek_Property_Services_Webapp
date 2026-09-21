"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { proposedPhotoDeduction, type PhotoReviewResult } from "@/lib/ai/photo-review-policy";

type Payload = {
  enabled: boolean; hasSubmission: boolean; canApprove: boolean;
  scoreReview: { id: string; score: number } | null;
  review: { id: string; status: string; error?: string | null; reviewedAt?: string | null; result: PhotoReviewResult | null; settings: { minConfidence: number; maxScoreContribution: number }; decision?: { action: string; deduction?: number; scoreBefore?: number; scoreAfter?: number; reason: string } } | null;
  photos: { mediaId: string; url: string | null; referenceUrls: (string | null)[] }[];
};

export function PhotoReviewPanel({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<{ jobId: string; data: Payload } | null>(null);
  const data = loaded?.jobId === jobId ? loaded.data : null;
  const currentJob = useRef(jobId);
  currentJob.current = jobId;
  const generation = useRef(0);
  const actionPending = useRef(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  useEffect(() => {
    const version = ++generation.current;
    let cancelled = false; const controller = new AbortController();
    setLoading(true); setError(""); setSelected([]); setReason(""); setSaving(false); actionPending.current = false;
    fetch(`/api/qa/jobs/${jobId}/photo-review`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load photo review.");
      if (!cancelled) setLoaded({ jobId, data: body });
    }).catch(err => { if (!cancelled) { setLoaded(null); setError(err.message); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); if (generation.current === version) generation.current++; };
  }, [jobId, reload]);
  const review = data?.review;
  const findings = review?.result?.observations.flatMap(item => item.findings) ?? [];
  const deduction = review ? proposedPhotoDeduction(findings, selected, review.settings.minConfidence, review.settings.maxScoreContribution) : 0;
  const ready = review?.status === "READY" && !review.reviewedAt;
  async function act(action: "analyze" | "approve" | "dismiss") {
    if (actionPending.current || loading || !data) return;
    const version = generation.current;
    const isCurrent = () => generation.current === version && currentJob.current === jobId;
    actionPending.current = true;
    setSaving(true); setError("");
    try {
      const body = action === "analyze" ? { action } : { action, analysisId: review!.id, reason, ...(action === "approve" ? { findingIds: selected, expectedReviewId: data!.scoreReview!.id, expectedScore: data!.scoreReview!.score } : {}) };
      const response = await fetch(`/api/qa/jobs/${jobId}/photo-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not update photo review.");
      if (isCurrent()) { setReload(value => value + 1); router.refresh(); }
    } catch (err) { if (isCurrent()) setError(err instanceof Error ? err.message : "Could not update photo review."); }
    finally { if (isCurrent()) { setSaving(false); actionPending.current = false; } }
  }
  return <ECard><ECardBody className="min-w-0 space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">AI photo review</h2><EButton variant="outline" size="sm" disabled={loading || saving} onClick={() => setReload(value => value + 1)}>Refresh analysis</EButton></div>
    <p className="text-sm">Compares submitted photos with the form’s uploaded reference photos. Findings are suggestions; only an approved deduction changes the QA score.</p>
    {error ? <p role="alert" className="break-words text-sm">{error}</p> : null}
    {loading ? <p role="status">Loading photo review…</p> : data ? <>
      {!data.hasSubmission ? <p>No cleaner form has been submitted yet.</p> : null}
      {!data.enabled ? <p className="text-sm">Automatic comparison is off. An admin can enable it in AI configuration.</p> : null}
      {data.hasSubmission && data.enabled && (!review || review.status === "FAILED") ? <EButton disabled={saving} onClick={() => act("analyze")}>{review ? "Retry analysis" : "Analyze submitted photos"}</EButton> : null}
      {review && ["PENDING", "RUNNING"].includes(review.status) ? <p role="status">{review.result?.observations.length ?? 0} photos checked. Background analysis continues in batches; refresh to check progress.</p> : null}
      {review?.error ? <p className="text-sm">{review.error}</p> : null}
      {review?.result ? <p className="text-sm">{review.result.observations.length} of {review.result.totalPhotos} photos processed. Photos without uploaded references are marked unassessed.</p> : null}
      {review?.result?.observations.map(observation => {
        const photos = data.photos.find(photo => photo.mediaId === observation.mediaId);
        return <details key={observation.mediaId} className="min-w-0 rounded border p-3" open={observation.findings.length > 0}>
          <summary className="cursor-pointer break-words font-medium">{observation.fieldLabel} · {observation.assessment === "skipped" || observation.assessment === "inconclusive" ? "Unassessed" : observation.assessment === "issue" ? "Review suggested issue" : "No visible issue reported"}</summary>
          <p className="my-2 break-words text-sm">{observation.summary}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos?.url ? <figure><a href={photos.url} target="_blank" rel="noreferrer"><img src={photos.url} alt={`Submitted ${observation.fieldLabel}`} className="h-36 w-full rounded object-contain" /></a><figcaption className="text-xs">Submitted photo</figcaption></figure> : <p className="text-xs">Submitted preview unavailable.</p>}
            {photos?.referenceUrls.map((url, index) => url ? <figure key={index}><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Reference ${index + 1} for ${observation.fieldLabel}`} className="h-36 w-full rounded object-contain" /></a><figcaption className="text-xs">Reference {index + 1}</figcaption></figure> : <p key={index} className="text-xs">Reference preview unavailable.</p>)}
          </div>
          {observation.findings.map(finding => {
            const eligible = finding.confidence >= review.settings.minConfidence;
            return <label key={finding.id} className="mt-3 flex min-h-11 items-start gap-2 rounded border p-2 text-sm">
              <input type="checkbox" aria-label={`Approve finding: ${finding.description}`} checked={selected.includes(finding.id)} disabled={!ready || !data.canApprove || !eligible || saving} onChange={event => setSelected(value => event.target.checked ? [...value, finding.id] : value.filter(id => id !== finding.id))} className="mt-1" />
              <span className="min-w-0 break-words">{finding.description}<span className="block text-xs">{finding.severity} · {Math.round(finding.confidence * 100)}% model confidence{!eligible ? " · below deduction threshold" : ""}</span></span>
            </label>;
          })}
        </details>;
      })}
      {review?.decision ? <div className="rounded border p-3 text-sm"><p>{review.decision.action === "approve" ? `Approved deduction: ${review.decision.deduction} points (${review.decision.scoreBefore} → ${review.decision.scoreAfter}).` : "Suggestions dismissed; no score change."}</p><p className="break-words">{review.decision.reason}</p></div> : null}
      {ready ? <div className="space-y-3 border-t pt-3">
        <p className="text-sm">Approve only issues not already reflected in the QA score. Areas with an existing QA issue must be adjusted through the existing QA review.</p>
        {!data.canApprove ? <p className="text-sm">Complete QA scoring first. Admin/ops, or the inspector who owns the authoritative QA review, can then approve deductions.</p> : <p className="text-sm">Selected deduction: <strong>{deduction} points</strong>. QA score: {data.scoreReview?.score} → {Math.max(0, (data.scoreReview?.score ?? 0) - deduction)}. Repeated photos of one field count once; total deduction is capped at {review.settings.maxScoreContribution} points.</p>}
        <label className="block text-sm">Review reason<textarea aria-label="Review reason" className="mt-1 block min-h-20 w-full rounded border bg-transparent p-2" value={reason} onChange={event => setReason(event.target.value)} disabled={saving} maxLength={2000} /></label>
        <div className="flex flex-wrap gap-2"><EButton disabled={saving || !data.canApprove || deduction <= 0 || reason.trim().length < 3} onClick={() => act("approve")}>Approve selected deduction</EButton><EButton variant="outline" disabled={saving || reason.trim().length < 3} onClick={() => act("dismiss")}>Dismiss suggestions</EButton></div>
      </div> : null}
    </> : null}
  </ECardBody></ECard>;
}
