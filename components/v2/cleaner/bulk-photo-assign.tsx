"use client";

/**
 * Bulk photo upload + categorise sheet (cleaner job form).
 *
 * The problem it solves: filing photos field-by-field means opening the phone
 * gallery once per upload section and hunting for the right shots each time. A
 * cleaner shooting 60 photos on a turnover did that 15+ times.
 *
 * Here the cleaner uploads the WHOLE batch once (same stamp → compress → POST
 * /api/uploads/direct pipeline `MediaCapture` uses — `prepareAndUploadFiles`,
 * never a second uploader), the results land in an unassigned `pool`, and then
 * they file them: multi-select photos → tap a destination field → assigned.
 * Assigned shots grey out (or hide) so only the unfiled ones remain in view,
 * and past decisions can be moved or returned to the pool at any time.
 *
 * All mutation rules live in `lib/cleaner/bulk-assign.ts` (pure + unit tested):
 * one media key is only ever in ONE place — the pool or exactly one field.
 * Assignment writes straight into the workspace's existing `UploadMap`, so
 * validation, autosave/draft and submit need no knowledge of this component.
 */
import * as React from "react";
import { z } from "zod";
import {
  Camera,
  Check,
  CheckCircle2,
  ImagePlus,
  Loader2,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import type { StampOptions } from "@/lib/uploads/stamp";
import {
  prepareAndUploadFiles,
  type CaptureSource,
  type CapturedMedia,
} from "@/components/v2/cleaner/media-capture";
import type { UploadMap } from "@/components/v2/cleaner/form-renderer";
import { useEvidenceScope } from "./evidence-context";
import { moveEvidence, removeEvidence } from "@/lib/cleaner/evidence-client";
import { destinationOf, type EvidenceDestination } from "@/lib/cleaner/evidence-destination";
import {
  addToPool,
  assignToField,
  assignmentIndex,
  nextUnmetField,
  shortfall,
  unassignKeys,
  type AssignField,
} from "@/lib/cleaner/bulk-assign";

export type BulkAssignField = AssignField;

interface PendingUpload {
  id: string;
  name: string;
  file: File;
  source: CaptureSource;
  status: "uploading" | "failed";
}

const proposalSchema = z.object({ captureId: z.string().min(1), key: z.string().min(1), version: z.number().int().nonnegative(), fieldId: z.string().min(1).nullable(), confidence: z.number().min(0).max(1), reason: z.string().max(2000) });
const proposalResponseSchema = z.object({ templateId: z.string(), formRevision: z.string(), draftIdentity: z.string(), minConfidence: z.number().min(0).max(1), proposals: z.array(proposalSchema).max(8) });
type PhotoProposal = z.infer<typeof proposalSchema>;

export function BulkPhotoAssign({
  open,
  onClose,
  pool,
  setPool,
  uploads,
  setUploads,
  fields,
  folder = "evidence",
  stamp,
  prepareAutoAssign,
}: {
  open: boolean;
  onClose: () => void;
  /** Uploaded-but-unfiled media. */
  pool: CapturedMedia[];
  setPool: (next: CapturedMedia[]) => void;
  /** The form's live upload map — assignment writes directly into it. */
  uploads: UploadMap;
  setUploads: (next: UploadMap) => void;
  /** Flat list of the form's upload fields, in form order. */
  fields: BulkAssignField[];
  folder?: string;
  /** Evidence-stamp context (address/reference) — same shape MediaCapture takes. */
  stamp?: StampOptions | null;
  /** Confirm the current answers are saved before the server derives destinations. */
  prepareAutoAssign?: () => Promise<void>;
}) {
  const evidenceScope = useEvidenceScope();
  const [moving, setMoving] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [activeFieldId, setActiveFieldId] = React.useState<string | null>(null);
  const [hideAssigned, setHideAssigned] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [uploadNote, setUploadNote] = React.useState<string | null>(null);
  const [proposals, setProposals] = React.useState<PhotoProposal[]>([]);
  const [proposalScope, setProposalScope] = React.useState<string | null>(null);
  const [analysing, setAnalysing] = React.useState(false);
  const [aiNote, setAiNote] = React.useState<string | null>(null);
  const [minConfidence, setMinConfidence] = React.useState(0.8);
  const [batchSize, setBatchSize] = React.useState(4);
  const [analysisProgress, setAnalysisProgress] = React.useState({ completed: 0, total: 0 });
  const [applying, setApplying] = React.useState(false);
  const requestRef = React.useRef<{ id: number; controller?: AbortController }>({ id: 0 });
  const movingRef = React.useRef(false);
  const stopApplyingRef = React.useRef(false);
  const scopeKey = JSON.stringify([open, evidenceScope, fields.map(field => field.id)]);
  const scopeKeyRef = React.useRef(scopeKey); scopeKeyRef.current = scopeKey;
  const fieldsRef = React.useRef(fields); fieldsRef.current = fields;
  React.useEffect(() => {
    ++requestRef.current.id; requestRef.current.controller?.abort();
    stopApplyingRef.current = true;
    setProposals([]); setProposalScope(null); setAnalysing(false); setAiNote(null); setBatchSize(4); setAnalysisProgress({ completed: 0, total: 0 });
    return () => { ++requestRef.current.id; requestRef.current.controller?.abort(); stopApplyingRef.current = true; };
  }, [scopeKey]);

  const state = React.useMemo(() => ({ pool, uploads }), [pool, uploads]);
  const assignedBy = React.useMemo(() => assignmentIndex(uploads), [uploads]);
  const fieldById = React.useMemo(() => {
    const map = new Map<string, BulkAssignField>();
    for (const f of fields) map.set(f.id, f);
    return map;
  }, [fields]);

  /** Everything the cleaner can act on: unfiled first (newest first), then filed. */
  const gallery = React.useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ media: CapturedMedia; fieldId: string | null }> = [];
    for (const m of [...pool].reverse()) {
      if (!m || seen.has(m.key)) continue;
      seen.add(m.key);
      out.push({ media: m, fieldId: null });
    }
    for (const f of fields) {
      const list = uploads[f.id];
      if (!Array.isArray(list)) continue;
      for (const m of [...list].reverse()) {
        if (!m || seen.has(m.key)) continue;
        seen.add(m.key);
        out.push({ media: m, fieldId: f.id });
      }
    }
    return out;
  }, [pool, uploads, fields]);

  const visible = hideAssigned ? gallery.filter((g) => g.fieldId === null) : gallery;
  const unassignedCount = pool.length;
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  // Reset transient UI whenever the sheet is reopened, and point the cleaner at
  // the first field still short of its minimum.
  React.useEffect(() => {
    if (!open) return;
    setSelected([]);
    setPickerOpen(false);
    setUploadNote(null);
    setActiveFieldId((prev) => prev ?? nextUnmetField(fields, uploads)?.id ?? fields[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = React.useCallback(
    (next: { pool: CapturedMedia[]; uploads: UploadMap }) => {
      if (next.pool !== pool) setPool(next.pool);
      if (next.uploads !== uploads) setUploads(next.uploads);
    },
    [pool, uploads, setPool, setUploads]
  );

  /* ── Upload ───────────────────────────────────────────────────────────── */

  // Latest-value refs: uploads resolve out of order, so the queue must append to
  // the CURRENT pool rather than the pool captured when the batch started.
  const poolRef = React.useRef(pool);
  poolRef.current = pool;
  const uploadsRef = React.useRef(uploads);
  uploadsRef.current = uploads;

  function cancelAnalysis() {
    ++requestRef.current.id; requestRef.current.controller?.abort();
    setAnalysing(false); setAiNote("Analysis cancelled. Completed suggestions are ready to review; remaining photos stay unassigned.");
  }

  async function autoAssign() {
    if (!evidenceScope || analysing || movingRef.current || pending.some(item => item.status === "uploading")) return;
    const scope = evidenceScope, startedScope = scopeKey;
    const id = ++requestRef.current.id;
    const controller = new AbortController(); requestRef.current.controller?.abort(); requestRef.current.controller = controller;
    const current = () => requestRef.current.id === id && scopeKeyRef.current === startedScope;
    const requestJson = async (url: string, init: RequestInit) => {
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
      try { const response = await fetch(url, { ...init, signal: controller.signal }); return { response, body: await response.json() }; }
      catch (error) { if (timedOut) throw new Error("Analysis request timed out. Retry remaining photos or assign manually."); throw error; }
      finally { clearTimeout(timeout); }
    };
    setAnalysing(true); setAiNote(null); setAnalysisProgress({ completed: 0, total: 0 });
    try {
      if (!prepareAutoAssign) throw new Error("Save the current form and reopen bulk photos before auto assigning.");
      await prepareAutoAssign(); if (!current()) return;
      const headers = { "Content-Type": "application/json", "X-Cleaner-Draft-Identity": scope.draftIdentity };
      const { response: read, body: draft } = await requestJson(`/api/cleaner/jobs/${encodeURIComponent(scope.jobId)}/draft`, { headers, cache: "no-store" });
      if (!current()) return;
      if (!read.ok) throw new Error(draft.error || "Could not check saved photos. Try again.");
      const unassigned = new Set(poolRef.current.filter(media => media.kind === "image" && !assignmentIndex(uploadsRef.current)[media.key]).map(media => media.key));
      const photos = Object.entries(draft.draft?.evidenceReceipts ?? {}).flatMap(([captureId, value]) => {
        const receipt = value as any;
        return receipt && !receipt.detached && receipt.draftIdentity === scope.draftIdentity && receipt.formRevision === scope.formRevision && destinationOf(receipt).type === "bulkPool" && unassigned.has(receipt.key) && Number.isInteger(receipt.version ?? 0)
          ? [{ captureId, key: receipt.key as string, version: receipt.version ?? 0 }] : [];
      });
      if (!photos.length) throw new Error("No acknowledged, unassigned photos are ready. Finish evidence recovery or assign manually.");
      const held = proposalScope === startedScope ? proposals.filter(row => photos.some(photo => photo.captureId === row.captureId && photo.key === row.key && photo.version === row.version)) : [];
      setProposalScope(startedScope); setProposals(held);
      let remaining = photos.filter(photo => !held.some(row => row.captureId === photo.captureId));
      let completed = 0, total = remaining.length, limit = batchSize, adapted = false;
      setAnalysisProgress({ completed, total });
      while (remaining.length && current()) {
        const freshRemaining = remaining.filter(photo => poolRef.current.some(media => media.key === photo.key) && !assignmentIndex(uploadsRef.current)[photo.key]);
        total -= remaining.length - freshRemaining.length; remaining = freshRemaining;
        setAnalysisProgress({ completed, total });
        if (!remaining.length) break;
        const batch = remaining.slice(0, limit);
        const { response, body } = await requestJson(`/api/cleaner/jobs/${encodeURIComponent(scope.jobId)}/evidence/auto-assign`, { method: "POST", headers, body: JSON.stringify({ templateId: scope.templateId, formRevision: scope.formRevision, photos: batch }) });
        if (!current()) return;
        if (!response.ok) {
          // This validation failure occurs before provider work; only reduce once.
          if (response.status === 400 && !adapted && Number.isInteger(body.maxBatchSize) && body.maxBatchSize >= 1 && body.maxBatchSize < batch.length) {
            limit = body.maxBatchSize; adapted = true; setBatchSize(limit); continue;
          }
          throw new Error(body.error || "Auto assignment is unavailable. Retry remaining photos or assign manually.");
        }
        const result = proposalResponseSchema.safeParse(body);
        if (!result.success || result.data.templateId !== scope.templateId || result.data.formRevision !== scope.formRevision || result.data.draftIdentity !== scope.draftIdentity || result.data.proposals.length !== batch.length || new Set(result.data.proposals.map(row => row.captureId)).size !== batch.length || result.data.proposals.some(row => !batch.some(photo => photo.captureId === row.captureId && photo.key === row.key && photo.version === row.version) || (row.fieldId !== null && !fieldsRef.current.some(field => field.id === row.fieldId)))) throw new Error("Suggestions no longer match this form. Try again; no photos were assigned.");
        const fresh = result.data.proposals.filter(row => poolRef.current.some(media => media.key === row.key) && !assignmentIndex(uploadsRef.current)[row.key]);
        setMinConfidence(result.data.minConfidence); setProposals(previous => [...previous.filter(row => !fresh.some(next => next.captureId === row.captureId)), ...fresh]);
        completed += batch.length; remaining = remaining.slice(batch.length); setAnalysisProgress({ completed, total });
      }
      if (current()) setAiNote("Analysis complete. Review suggestions before filing; uncertain photos need a manual section choice.");
    } catch (error) {
      if (current()) setAiNote(error instanceof Error ? error.message : "Analysis failed. Try again or assign manually.");
    } finally { if (current()) setAnalysing(false); }
  }

  async function acceptProposals(rows: PhotoProposal[]) {
    if (!evidenceScope || movingRef.current) return;
    const scope = evidenceScope, startedScope = scopeKey;
    movingRef.current = true; stopApplyingRef.current = false; setMoving(true); setApplying(true); setAiNote(null);
    let count = 0;
    try {
      for (const row of rows) {
        if (stopApplyingRef.current || scopeKeyRef.current !== startedScope) break;
        const media = poolRef.current.find(media => media.key === row.key);
        if (!media || assignmentIndex(uploadsRef.current)[row.key] || !row.fieldId || !fieldsRef.current.some(field => field.id === row.fieldId)) continue;
        await moveEvidence(scope, media, { type: "bulkPool" }, { type: "formField", fieldId: row.fieldId }, { captureId: row.captureId, version: row.version });
        if (scopeKeyRef.current !== startedScope) break;
        // Another source may have updated the upload map while the receipt was saved.
        if (poolRef.current.some(item => item.key === row.key) && !assignmentIndex(uploadsRef.current)[row.key]) {
          const next = assignToField({ pool: poolRef.current, uploads: uploadsRef.current }, [row.key], row.fieldId);
          poolRef.current = next.pool; uploadsRef.current = next.uploads; commit(next); ++count;
        }
        setProposals(current => current.filter(item => item.captureId !== row.captureId));
      }
      if (scopeKeyRef.current === startedScope) setAiNote(`${count} photo${count === 1 ? "" : "s"} assigned. Select a filed photo to move it or undo with Unassign.`);
    } catch (error) {
      if (scopeKeyRef.current === startedScope) setAiNote(`${count} photo${count === 1 ? "" : "s"} assigned. ${error instanceof Error ? error.message : "Assignment was not confirmed. Refresh evidence before trying again."}`);
    } finally { movingRef.current = false; setMoving(false); setApplying(false); }
  }

  const runUpload = React.useCallback(
    async (items: PendingUpload[]) => {
      if (evidenceScope === null) { setUploadNote("Reload the current form before capturing evidence."); return; }
      if (evidenceScope) {
        const result = await prepareAndUploadFiles(items.map(item => item.file), { folder, stamp, source: items[0]?.source ?? "gallery",
          evidence: { ...evidenceScope, fieldId: "bulkPool", destination: { type: "bulkPool" } } });
        setPool(addToPool({ pool: poolRef.current, uploads: uploadsRef.current }, result.results).pool);
        setPending([]);
        if (result.failedCount) setUploadNote("Some originals need recovery. Use Device evidence recovery on the job.");
        return;
      }
      for (const item of items) {
        // One request per file so each tile reports its own success/failure and
        // can be retried without re-uploading the whole batch.
        // eslint-disable-next-line no-await-in-loop
        const { results, failedCount } = await prepareAndUploadFiles([item.file], {
          folder,
          stamp,
          source: item.source,
        });
        if (failedCount > 0 || results.length === 0) {
          setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "failed" } : p)));
          setUploadNote("Some photos failed to upload — tap Retry on the red tiles.");
          continue;
        }
        setPool(addToPool({ pool: poolRef.current, uploads: uploadsRef.current }, results).pool);
        setPending((prev) => prev.filter((p) => p.id !== item.id));
      }
    },
    [folder, stamp, setPool, evidenceScope]
  );

  function queueFiles(files: FileList | null, source: CaptureSource) {
    if (!files || files.length === 0) return;
    setUploadNote(null);
    const items: PendingUpload[] = Array.from(files).map((file, i) => ({
      id: `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      file,
      source,
      status: "uploading",
    }));
    setPending((prev) => [...prev, ...items]);
    void runUpload(items);
  }

  function retry(item: PendingUpload) {
    setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "uploading" } : p)));
    void runUpload([{ ...item, status: "uploading" }]);
  }

  /* ── Assignment ───────────────────────────────────────────────────────── */

  async function acknowledgeMoves(to: EvidenceDestination) {
    if (evidenceScope === null) throw new Error("Reload the current form before moving evidence.");
    if (!evidenceScope) return;
    for (const key of selected) {
      const item = gallery.find(item => item.media.key === key);
      if (!item) continue;
      await moveEvidence(evidenceScope, item.media, item.fieldId ? { type: "formField", fieldId: item.fieldId } : { type: "bulkPool" }, to);
      const next = to.type === "formField" ? assignToField({ pool: poolRef.current, uploads: uploadsRef.current }, [key], to.fieldId) : unassignKeys({ pool: poolRef.current, uploads: uploadsRef.current }, [key]);
      poolRef.current = next.pool; uploadsRef.current = next.uploads; commit(next);
    }
  }
  async function assign(fieldId: string) {
    if (movingRef.current) return;
    if (selected.length === 0 || !fieldId) return;
    movingRef.current = true; setMoving(true);
    try {
    await acknowledgeMoves({ type: "formField", fieldId });
    const next = assignToField({ pool: poolRef.current, uploads: uploadsRef.current }, selected, fieldId);
    commit(next);
    setSelected([]);
    setPickerOpen(false);
    // Assign-next loop: jump the highlight to the next field still short.
    setActiveFieldId(nextUnmetField(fields, next.uploads, fieldId)?.id ?? fieldId);
    } catch (error) { setUploadNote(error instanceof Error ? error.message : "Move failed. Reload evidence."); }
    finally { movingRef.current = false; setMoving(false); }
  }

  async function returnToPool() {
    if (movingRef.current) return;
    if (selected.length === 0) return;
    movingRef.current = true; setMoving(true);
    try {
    await acknowledgeMoves({ type: "bulkPool" });
    commit(unassignKeys({ pool: poolRef.current, uploads: uploadsRef.current }, selected));
    setSelected([]);
    } catch (error) { setUploadNote(error instanceof Error ? error.message : "Move failed. Reload evidence."); }
    finally { movingRef.current = false; setMoving(false); }
  }

  function toggle(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const selectedAssignedCount = selected.filter((k) => assignedBy[k]).length;
  async function removeSelected() {
    if (!evidenceScope || movingRef.current) return;
    movingRef.current = true; setMoving(true);
    try {
      for (const key of selected) {
        await removeEvidence(evidenceScope, key);
        const next = { pool: poolRef.current.filter(media => media.key !== key), uploads: Object.fromEntries(Object.entries(uploadsRef.current).map(([field, media]) => [field, media.filter(item => item.key !== key)])) };
        poolRef.current = next.pool; uploadsRef.current = next.uploads; commit(next);
      }
      setSelected([]);
    } catch (error) { setUploadNote(error instanceof Error ? error.message : "Removal failed."); }
    finally { movingRef.current = false; setMoving(false); }
  }
  const sections = React.useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, BulkAssignField[]>();
    for (const f of fields) {
      const title = f.sectionTitle || "Photos";
      if (!map.has(title)) {
        map.set(title, []);
        order.push(title);
      }
      map.get(title)!.push(f);
    }
    return order.map((title) => ({ title, fields: map.get(title)! }));
  }, [fields]);

  const reviewable = proposalScope === scopeKey ? proposals.filter(row => pool.some(media => media.key === row.key) && !assignedBy[row.key]) : [];
  const highConfidence = reviewable.filter(row => row.fieldId !== null && row.confidence >= minConfidence);
  if (!open) return null;

  return (
    <div role="dialog" aria-label="Bulk photos" aria-modal="true" className="fixed inset-0 z-[110] flex min-w-0 flex-col bg-[hsl(var(--e-background))] [overflow-wrap:anywhere]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-4 py-3">
        <div className="min-w-0">
          <p className="e-eyebrow">Bulk photos</p>
          <p className="truncate text-[0.9375rem] font-[600]">
            Unassigned: <span className="tabular-nums">{unassignedCount}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={applying}
          aria-label="Close bulk photos"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-40 pt-4">
        {/* Step 1 — upload the whole batch in one go */}
        <section className="space-y-2">
          <p className="e-eyebrow">1 · Upload everything</p>
          <div className="flex flex-wrap gap-2">
            <PickerButton
              label="Choose photos"
              icon={<ImagePlus className="h-4 w-4" />}
              onFiles={(f) => queueFiles(f, "gallery")}
            />
            <PickerButton
              label="Take photos"
              icon={<Camera className="h-4 w-4" />}
              capture="environment"
              onFiles={(f) => queueFiles(f, "camera")}
            />
          </div>
          {pending.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-[var(--e-radius-sm)] border px-2 text-center text-[0.625rem]",
                    p.status === "failed"
                      ? "border-[hsl(var(--e-danger))] text-[hsl(var(--e-danger))]"
                      : "border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))]"
                  )}
                >
                  {p.status === "uploading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => retry(p)}
                      className="inline-flex items-center gap-1 font-[600] underline-offset-2 hover:underline"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Retry
                    </button>
                  )}
                  <span className="line-clamp-1 w-full">{p.name}</span>
                </div>
              ))}
            </div>
          ) : null}
          {uploadNote ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{uploadNote}</p>
          ) : null}
        </section>

        <section aria-label="Auto assignment suggestions" className="min-w-0 space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><p className="font-semibold">Auto assign photos</p><p className="text-xs text-[hsl(var(--e-muted-foreground))]">Analyse {pool.filter(media => media.kind === "image").length} unassigned photos in batches of up to {batchSize}. Existing suggestions are kept. Review before filing.</p></div>
            <EButton className="min-h-11" disabled={!evidenceScope || !prepareAutoAssign || analysing || moving || !pool.some(media => media.kind === "image") || pending.some(item => item.status === "uploading")} onClick={() => void autoAssign()}>{analysing ? <><Loader2 className="h-4 w-4 animate-spin" />Analysing…</> : "Auto assign"}</EButton>
          </div>
          <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Uses this property&apos;s reference photos and previous labelled submissions when available.</p>
          {analysing ? <EButton variant="outline" className="min-h-11" onClick={cancelAnalysis}>Cancel analysis</EButton> : null}
          {analysisProgress.total > 0 ? <p role="status" className="text-sm">Analysed {analysisProgress.completed} of {analysisProgress.total} photos.</p> : null}
          {aiNote ? <p role="status" className="text-sm">{aiNote}</p> : null}
          {highConfidence.length > 0 ? <EButton className="h-auto min-h-11 w-full whitespace-normal py-2" disabled={moving || analysing} onClick={() => void acceptProposals(highConfidence)}>Accept {highConfidence.length} high-confidence suggestion{highConfidence.length === 1 ? "" : "s"}</EButton> : null}
          {applying ? <EButton variant="outline" className="min-h-11 whitespace-normal" onClick={() => { stopApplyingRef.current = true; setAiNote("Stopping after the current photo is confirmed."); }}>Stop after current photo</EButton> : null}
          {reviewable.map(row => {
            const media = pool.find(media => media.key === row.key)!;
            const field = row.fieldId ? fieldById.get(row.fieldId) : undefined;
            return <article key={row.captureId} className="min-w-0 space-y-2 border-t border-[hsl(var(--e-border))] pt-3">
              <div className="flex min-w-0 items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={media.url} alt={media.name || "Photo suggestion"} className="h-16 w-16 shrink-0 rounded object-cover" />
                <div className="min-w-0"><p className="text-sm font-semibold">{field ? `${field.sectionTitle} · ${field.label}` : "Choose a section manually"}</p><p className="text-xs">{Math.round(row.confidence * 100)}% confidence{row.confidence < minConfidence ? " · Review needed" : ""}</p><p className="mt-1 text-sm">{row.reason}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {field ? <EButton className="min-h-11" variant="outline" disabled={moving || analysing} onClick={() => void acceptProposals([row])}>Accept suggestion</EButton> : <EButton className="min-h-11" variant="outline" disabled={moving} onClick={() => { setSelected([row.key]); setPickerOpen(true); }}>Choose section</EButton>}
                <EButton className="min-h-11" variant="ghost" disabled={moving} onClick={() => setProposals(current => current.filter(item => item.captureId !== row.captureId))}>Dismiss suggestion</EButton>
              </div>
            </article>;
          })}
        </section>

        {/* Step 2 — categorise */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="e-eyebrow">2 · Categorise</p>
            <label className="inline-flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <input
                type="checkbox"
                checked={hideAssigned}
                onChange={(e) => setHideAssigned(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Hide assigned
            </label>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {gallery.length === 0
                ? "Upload photos above, then tap them to file into sections."
                : "Everything is filed. Untick “Hide assigned” to review."}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {visible.map(({ media, fieldId }) => {
                const isSelected = selectedSet.has(media.key);
                const label = fieldId ? fieldById.get(fieldId)?.label ?? fieldId : null;
                return (
                  <button
                    key={media.key}
                    type="button"
                    onClick={() => toggle(media.key)}
                    aria-pressed={isSelected}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-[var(--e-radius-sm)] border bg-[hsl(var(--e-surface-sunken))]",
                      isSelected
                        ? "border-[hsl(var(--e-gold))] ring-2 ring-[hsl(var(--e-gold))]"
                        : "border-[hsl(var(--e-border))]"
                    )}
                  >
                    {media.kind === "video" ? (
                      <video src={media.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={media.url}
                        alt={media.name || "photo"}
                        loading="lazy"
                        className={cn("h-full w-full object-cover", fieldId ? "opacity-40 grayscale" : null)}
                      />
                    )}
                    {isSelected ? (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))]">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                    {label ? (
                      <span className="absolute inset-x-0 bottom-0 line-clamp-1 bg-[hsl(var(--e-background)/0.8)] px-1 py-0.5 text-[0.5625rem] font-[600]">
                        {label}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Step 3 — destinations */}
        <section className="space-y-3">
          <p className="e-eyebrow">3 · Sections</p>
          {sections.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              This form has no photo sections.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.title} className="space-y-1.5">
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                  {section.title}
                </p>
                {section.fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    media={uploads[field.id] ?? []}
                    active={activeFieldId === field.id}
                    short={shortfall(field, uploads)}
                    onSelect={() => setActiveFieldId(field.id)}
                  />
                ))}
              </div>
            ))
          )}
        </section>
      </div>

      {/* Sticky action footer */}
      <div className="border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3">
        <div className="flex items-center justify-between gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <span className="tabular-nums">
            {selected.length} selected
            {selectedAssignedCount > 0 ? ` · ${selectedAssignedCount} already filed` : ""}
          </span>
          {selected.length > 0 ? (
            <button type="button" onClick={() => setSelected([])} className="underline-offset-2 hover:underline">
              Clear
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <EButton
            variant="gold"
            size="sm"
            className="h-auto min-h-11 w-full min-w-0 flex-none whitespace-normal py-2 sm:w-auto sm:flex-1"
            disabled={moving || selected.length === 0 || !activeFieldId}
            onClick={() => activeFieldId && assign(activeFieldId)}
          >
            <CheckCircle2 className="h-4 w-4" />
            Assign {selected.length || ""} to {activeFieldId ? fieldById.get(activeFieldId)?.label ?? "section" : "…"}
          </EButton>
          <EButton
            variant="outline"
            size="sm"
            disabled={moving || selected.length === 0 || fields.length === 0}
            onClick={() => setPickerOpen(true)}
          >
            Assign to…
          </EButton>
          <EButton
            variant="ghost"
            size="sm"
            disabled={moving || selectedAssignedCount === 0}
            onClick={returnToPool}
          >
            <Undo2 className="h-4 w-4" /> Unassign
          </EButton>
          <EButton variant="outline" size="sm" onClick={onClose} disabled={applying}>
            Done
          </EButton>
          {evidenceScope ? <EButton variant="ghost" size="sm" disabled={moving || !selected.length} onClick={() => void removeSelected()}>Remove selected; keep originals</EButton> : null}
        </div>
      </div>

      {/* Field picker (flow b: pick photos first, then choose the destination) */}
      {pickerOpen ? (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-[hsl(160_18%_8%/0.45)]">
          <div
            className="max-h-[70vh] overflow-y-auto rounded-t-[var(--e-radius)] border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[0.9375rem] font-[600]">
                Move {selected.length} photo{selected.length === 1 ? "" : "s"} to…
              </p>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                aria-label="Close picker"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border))]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {sections.map((section) => (
                <div key={section.title} className="space-y-1">
                  <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                    {section.title}
                  </p>
                  {section.fields.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => assign(field.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2 text-left text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]"
                    >
                      <span className="min-w-0 truncate">{field.label}</span>
                      <CountChip field={field} count={(uploads[field.id] ?? []).length} />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CountChip({ field, count }: { field: BulkAssignField; count: number }) {
  const need = Math.max(field.minPhotos ?? 0, field.required ? 1 : 0);
  if (need === 0) return <EBadge tone="neutral">{count}</EBadge>;
  return (
    <EBadge tone={count >= need ? "success" : "warning"}>
      {count}/{need}
    </EBadge>
  );
}

function FieldRow({
  field,
  media,
  active,
  short,
  onSelect,
}: {
  field: BulkAssignField;
  media: CapturedMedia[];
  active: boolean;
  short: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-[var(--e-radius-sm)] border px-3 py-2 text-left",
        active
          ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-[550]">{field.label}</span>
        {media.length > 0 ? (
          <span className="mt-1 flex gap-1">
            {media.slice(0, 4).map((m) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={m.key}
                src={m.url}
                alt=""
                loading="lazy"
                className="h-8 w-8 rounded-[3px] object-cover"
              />
            ))}
            {media.length > 4 ? (
              <span className="flex h-8 items-center text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">
                +{media.length - 4}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
            {short > 0 ? `Needs ${short} more` : "No photos yet"}
          </span>
        )}
      </span>
      <CountChip field={field} count={media.length} />
    </button>
  );
}

function PickerButton({
  label,
  icon,
  capture,
  onFiles,
}: {
  label: string;
  icon: React.ReactNode;
  capture?: "environment" | "user";
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550]">
      <input
        type="file"
        accept="image/*"
        multiple
        {...(capture ? { capture } : {})}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      {icon}
      {label}
    </label>
  );
}
