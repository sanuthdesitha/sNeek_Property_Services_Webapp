"use client";

/**
 * Section 3, "Photo checks": how sure the AI must be (confidence bands with an
 * example finding), points and batches, photo memory and the dedicated
 * recognition service, properties opted out (managed in a dialog with its own
 * revisioned save) and the agreement with inspectors. Values come from the
 * photo workflow settings (/api/admin/ai/vision) and save with Save changes.
 */
import * as React from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { cn } from "@/lib/utils";
import type { AgreementReport } from "@/lib/ai/photo-review-evaluation";
import type { VisionSettings } from "@/lib/ai/vision-settings-schema";
import { CONFIDENCE_BANDS, lowestDeductibleBand, minConfidenceForBand, type AiPage, type BandKey } from "./ai-config-model";
import { AI_FIELD, AI_LABEL, AI_MUTED, AiSectionHeading, AiSwitch } from "./ai-ui";

export type OptOutState = { revision: number; propertyIds: string[]; corrupt: boolean; properties: { id: string; name: string; suburb: string | null }[] };
export type PartLoad<T> = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; data: T };

function NumberField({ label, value, min, max, step = 1, disabled, onChange, suffix }: { label: string; value: number; min: number; max: number; step?: number; disabled: boolean; onChange: (value: number) => void; suffix?: string }) {
  const id = React.useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[0.71875rem] text-[hsl(var(--e-text-secondary))]">{label}</label>
      <span className="flex items-center gap-1.5">
        <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} className={cn(AI_FIELD, "tabular-nums")} value={Number.isFinite(value) ? value : ""} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix ? <span className={cn("whitespace-nowrap text-[0.75rem]", AI_MUTED)}>{suffix}</span> : null}
      </span>
      <span className={cn("mt-0.5 block text-[0.6875rem]", AI_MUTED)}>{min} to {max}</span>
    </div>
  );
}

function ConfidenceCard({ page, vision }: { page: AiPage; vision: VisionSettings }) {
  const lowest = lowestDeductibleBand(vision.minConfidence);
  const eligible = (value: number) => value >= vision.minConfidence;
  const mediumEligible = eligible(0.7);
  const [exactOpen, setExactOpen] = React.useState(false);
  return (
    <ECard className="flex min-w-0 flex-col gap-2.5 p-4">
      <h3 className="text-[0.9375rem] font-semibold">How sure the AI must be</h3>
      <div className="grid grid-cols-3 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
        {CONFIDENCE_BANDS.map((band) => (
          <div key={band.key} className={cn("flex flex-col gap-0.5 border-l border-[hsl(var(--e-border))] p-2 text-[0.75rem] first:border-0", eligible(band.value) && "bg-[hsl(var(--e-primary-soft))]")}>
            <b>{band.label}</b>
            <span className={cn("text-[0.71875rem]", AI_MUTED)}>{eligible(band.value) ? "Can be proposed as a deduction." : "\"Worth a look\". Shown to the reviewer, never proposed as a deduction."}</span>
          </div>
        ))}
      </div>
      <label className="flex flex-wrap items-center justify-between gap-2 text-[0.75rem]">
        <span>Lowest band that may propose a deduction</span>
        <select className={cn(AI_FIELD, "w-[8.5rem]")} value={lowest} disabled={page.locked} onChange={(event) => page.setVisionDraft((old) => ({ ...old, minConfidence: minConfidenceForBand(event.target.value as BandKey, old.minConfidence) }))}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="none">None (never)</option>
        </select>
      </label>
      <button type="button" aria-expanded={exactOpen} className={cn("self-start text-[0.71875rem] underline", AI_MUTED)} onClick={() => setExactOpen((value) => !value)}>Exact minimum confidence</button>
      {exactOpen ? (
        <NumberField label="Minimum confidence (0 to 1)" value={vision.minConfidence} min={0} max={1} step={0.05} disabled={page.locked} onChange={(minConfidence) => page.setVisionDraft((old) => ({ ...old, minConfidence }))} />
      ) : null}
      <span className="e-eyebrow">Example finding</span>
      <div className="flex gap-2.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
        <span role="img" aria-label="Example photo with a box around streaks on a mirror" className="relative h-[76px] w-24 shrink-0 rounded-[8px] bg-[linear-gradient(135deg,hsl(200_10%_84%),hsl(160_8%_70%))]">
          <i className="absolute left-[18px] top-[30px] h-6 w-[34px] rounded-[5px] border-2 border-[hsl(var(--e-warning))]" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5 text-[0.75rem]">
          <b>Ensuite mirror: streaks lower left</b>
          <span>Medium confidence · minor</span>
          <span className={AI_MUTED}>
            {mediumEligible
              ? `Proposes −${vision.minorPoints} ${vision.minorPoints === 1 ? "point" : "points"}. The reviewer approves or dismisses it; nothing changes the score until they do.`
              : "Shown to the reviewer as \"Worth a look\"; not proposed as a deduction."}
          </span>
        </div>
      </div>
    </ECard>
  );
}

function PointsCard({ page, vision, recognitionConfigured, memoryOpen, onToggleMemory }: { page: AiPage; vision: VisionSettings; recognitionConfigured: boolean; memoryOpen: boolean; onToggleMemory: () => void }) {
  const set = (patch: Partial<VisionSettings>) => page.setVisionDraft((old) => ({ ...old, ...patch }));
  return (
    <ECard className="flex min-w-0 flex-col gap-2.5 p-4">
      <h3 className="text-[0.9375rem] font-semibold">Points and batches</h3>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <NumberField label="Approved minor finding" value={vision.minorPoints} min={0} max={10} disabled={page.locked} suffix="points" onChange={(minorPoints) => set({ minorPoints })} />
        <NumberField label="Approved major finding" value={vision.majorPoints} min={0} max={20} disabled={page.locked} suffix="points" onChange={(majorPoints) => set({ majorPoints })} />
        <NumberField label="Most a check may propose" value={vision.maxScoreContribution} min={0} max={20} disabled={page.locked} suffix="points" onChange={(maxScoreContribution) => set({ maxScoreContribution })} />
        <NumberField label="Photos per request" value={vision.batchSize} min={1} max={8} disabled={page.locked} onChange={(batchSize) => set({ batchSize })} />
      </div>
      {vision.minorPoints > vision.majorPoints ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">A minor finding cannot deduct more points than a major one.</p> : null}
      <p className={cn("text-[0.71875rem]", AI_MUTED)}>A reviewer still chooses which findings to approve; repeated photos of one field count once and the total stays within the most a check may propose.</p>
      <hr className="border-[hsl(var(--e-border))]" />
      <div className="flex items-center justify-between gap-3 text-[0.75rem]">
        <span>Learn rooms from past submissions (photo memory)</span>
        <AiSwitch checked={vision.historicalAssignmentExamplesEnabled} disabled={page.locked || !vision.assignmentEnabled} label="Use prior photos from the same property to recognize rooms" onChange={(historicalAssignmentExamplesEnabled) => set({ historicalAssignmentExamplesEnabled })} />
      </div>
      {!vision.assignmentEnabled ? <p className={cn("-mt-1.5 text-[0.6875rem]", AI_MUTED)}>Used by photo assignment, which is off in its workflow switch.</p> : null}
      <div className="flex items-center justify-between gap-3 text-[0.75rem]">
        <span>Dedicated recognition service</span>
        <AiSwitch checked={vision.dedicatedRecognitionEnabled} disabled={page.locked || (!recognitionConfigured && !vision.dedicatedRecognitionEnabled)} label="Train and use dedicated property recognition" onChange={(dedicatedRecognitionEnabled) => set({ dedicatedRecognitionEnabled })} />
      </div>
      <p className={cn("text-[0.71875rem]", AI_MUTED)}>
        {recognitionConfigured
          ? "Service credentials are configured; connectivity and trained model quality are not verified here. Turning it on sends eligible property photos to that service to train a property classifier."
          : "Needs MODEL_SERVICE_URL and MODEL_SERVICE_TOKEN on the server."}{" "}
        <button type="button" aria-expanded={memoryOpen} aria-controls="ai-photo-memory" className="font-medium text-[hsl(var(--e-foreground))] underline" onClick={onToggleMemory}>{memoryOpen ? "Hide photo memory" : "Review photo memory ›"}</button>
      </p>
    </ECard>
  );
}

function AgreementTable({ report }: { report: AgreementReport | null }) {
  if (!report) return <p role="alert" className="text-[0.75rem]">The agreement figures could not be read.</p>;
  if (report.rows.length === 0) return <p className={cn("text-[0.75rem]", AI_MUTED)}>No reviewed AI photo findings yet.</p>;
  return (
    <div role="region" aria-label="Agreement with inspectors" tabIndex={0} className="overflow-x-auto">
      <table className="w-full text-left text-[0.75rem]">
        <thead className="text-[hsl(var(--e-text-secondary))]"><tr className="border-b border-[hsl(var(--e-border))]"><th scope="col" className="py-1.5 pr-2 font-semibold">Model</th><th scope="col" className="py-1.5 pr-2 text-right font-semibold">Reviews</th><th scope="col" className="py-1.5 text-right font-semibold">Agreed</th></tr></thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={`${row.provider}-${row.model}`} className="border-b border-[hsl(var(--e-border))] align-top last:border-0">
              <td className="break-words py-1.5 pr-2 [overflow-wrap:anywhere]">{row.provider === "ollama" ? "Local" : row.provider} · {row.model}<div className={cn("text-[0.6875rem]", AI_MUTED)}>Photos: {row.cannotTell} cannot tell / {row.notChecked} not checked of {row.photos}</div></td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{row.reviews}</td>
              <td className="py-1.5 text-right tabular-nums">{row.agreement === null ? "No labelled findings" : `${Math.round(row.agreement * 100)}%`}<div className={cn("text-[0.6875rem]", AI_MUTED)}>{row.confirmed} / {row.notSelected} / {row.dismissed}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.skipped ? <p className={cn("text-[0.6875rem]", AI_MUTED)}>{report.skipped} reviewed analyses could not be read and are not counted.</p> : null}
    </div>
  );
}

function OptOutCard({ page, optOut, onManage, onRetry }: { page: AiPage; optOut: PartLoad<OptOutState>; onManage: () => void; onRetry: () => void }) {
  const names = optOut.status === "ready" ? new Map(optOut.data.properties.map((property) => [property.id, property.name])) : new Map<string, string>();
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[0.9375rem] font-semibold">Properties opted out{optOut.status === "ready" ? ` · ${optOut.data.propertyIds.length}` : ""}</h3>
        <EButton type="button" size="sm" variant="outline" disabled={optOut.status !== "ready"} onClick={onManage}>{page.canEdit ? "Manage" : "View"}</EButton>
      </div>
      {optOut.status === "loading" ? <p role="status" className="text-[0.75rem]">Loading opted-out properties…</p> : null}
      {optOut.status === "failed" ? <p role="alert" className="text-[0.75rem]">{optOut.message} <button type="button" className="underline" onClick={onRetry}>Retry</button></p> : null}
      {optOut.status === "ready" ? (
        <>
          {optOut.data.corrupt ? <EToneNotice tone="problem" className="p-2.5"><p>The saved list could not be read, so AI photo review is paused for every property until it is saved again.</p></EToneNotice> : null}
          <div className="flex flex-wrap gap-1.5">
            {optOut.data.propertyIds.length === 0 ? <span className={cn("text-[0.75rem]", AI_MUTED)}>No properties opted out.</span> : optOut.data.propertyIds.map((id) => (
              <span key={id} className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-2 py-0.5 text-[0.71875rem]">{names.get(id) ?? "Removed property"}</span>
            ))}
          </div>
        </>
      ) : null}
      <p className={cn("text-[0.71875rem]", AI_MUTED)}>No AI photo checks there; reviewers check by eye. Photo checks for duplicates and reuse still run; they use no AI.</p>
    </>
  );
}

export function PhotoChecksSection({ page, vision, visionLoad, onRetryVision, recognitionConfigured, agreement, optOut, onRetryOptOut, onManageOptOut, memory }: {
  page: AiPage;
  vision: VisionSettings | null;
  visionLoad: PartLoad<unknown>["status"];
  onRetryVision: () => void;
  recognitionConfigured: boolean;
  agreement: AgreementReport | null;
  optOut: PartLoad<OptOutState>;
  onRetryOptOut: () => void;
  onManageOptOut: () => void;
  memory: { open: boolean; toggle: () => void; panel: React.ReactNode };
}) {
  return (
    <section aria-labelledby="ai-photo-heading" id="photo-checks" className="min-w-0 space-y-3 scroll-mt-24">
      <AiSectionHeading id="ai-photo-heading" number={3} title="Photo checks" aside="Runs on the provider chosen for Photo comparison above. Administrators edit; operations managers can read." />
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[1.1fr_1fr_1fr]">
        {vision ? (
          <>
            <ConfidenceCard page={page} vision={vision} />
            <PointsCard page={page} vision={vision} recognitionConfigured={recognitionConfigured} memoryOpen={memory.open} onToggleMemory={memory.toggle} />
          </>
        ) : (
          <ECard className="p-4 lg:col-span-2">
            {visionLoad === "failed"
              ? <p role="alert" className="text-[0.8125rem]">Photo check settings could not be read. <button type="button" className="underline" onClick={onRetryVision}>Retry</button></p>
              : <p role="status" className="text-[0.8125rem]">Loading photo check settings…</p>}
          </ECard>
        )}
        <ECard className="flex min-w-0 flex-col gap-2.5 p-4">
          <OptOutCard page={page} optOut={optOut} onManage={onManageOptOut} onRetry={onRetryOptOut} />
          <hr className="border-[hsl(var(--e-border))]" />
          <div className="flex items-center justify-between gap-2"><h3 className="text-[0.9375rem] font-semibold">Agreement with inspectors</h3><span className={cn("text-[0.75rem]", AI_MUTED)}>last 90 days</span></div>
          <AgreementTable report={agreement} />
          <p className={cn("text-[0.71875rem]", AI_MUTED)}>Confirmed / not selected / dismissed. A finding selected in an approved deduction is confirmed; one left out, or in dismissed suggestions, is not. Shows how often suggestions were accepted, not what the AI missed.</p>
        </ECard>
      </div>
      <div id="ai-photo-memory" hidden={!memory.open}>{memory.open ? memory.panel : null}</div>
    </section>
  );
}

/** Manage the opted-out list: its own revisioned save (409 keeps the selection), draft kept while closed. */
export function OptOutDialog({ open, canEdit, optOut, onClose, onSaved }: {
  open: boolean;
  canEdit: boolean;
  optOut: OptOutState | null;
  onClose: () => void;
  onSaved: (next: OptOutState) => void;
}) {
  const [draft, setDraft] = React.useState<string[] | null>(null);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [conflict, setConflict] = React.useState<{ revision: number; propertyIds: string[] } | null>(null);
  if (!optOut) return null;
  const selected = draft ?? optOut.propertyIds;
  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...optOut.propertyIds].sort());
  const names = new Map(optOut.properties.map((property) => [property.id, `${property.name}${property.suburb ? `, ${property.suburb}` : ""}`]));
  const needle = query.trim().toLowerCase();
  const matches = needle ? optOut.properties.filter((property) => `${property.name} ${property.suburb ?? ""}`.toLowerCase().includes(needle)).slice(0, 40) : [];

  async function save(revision: number) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/ai/photo-review-opt-out", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, propertyIds: selected }) });
      const body = (await response.json().catch(() => ({}))) as Partial<OptOutState> & { error?: string; current?: { revision: number; propertyIds: string[] } };
      if (response.status === 409 && body.current) {
        setConflict(body.current);
        setMessage({ tone: "bad", text: "Someone changed this list after you opened it. Your selection is kept." });
        return;
      }
      if (!response.ok || !Array.isArray(body.propertyIds)) throw new Error(body.error || "Not saved.");
      setConflict(null);
      setDraft(null);
      setMessage({ tone: "ok", text: "Saved." });
      onSaved(body as OptOutState);
    } catch (error) {
      setMessage({ tone: "bad", text: error instanceof Error ? error.message : "Not saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open={open}
      title="Properties opted out of AI photo checks"
      description="Photos from these properties are never sent for AI photo review. Owners' requests are noted on each property."
      busy={busy}
      onClose={onClose}
      footer={canEdit ? (
        <>
          {conflict ? (
            <>
              <EButton variant="outline" disabled={busy} onClick={() => { setDraft(conflict.propertyIds); onSaved({ ...optOut, revision: conflict.revision, propertyIds: conflict.propertyIds }); setConflict(null); setMessage(null); }}>Load theirs</EButton>
              <EButton disabled={busy} onClick={() => void save(conflict.revision)}>Save my selection anyway</EButton>
            </>
          ) : (
            <>
              <EButton variant="outline" disabled={busy} onClick={onClose}>Close</EButton>
              <EButton disabled={busy || !dirty} onClick={() => void save(optOut.revision)}>{busy ? "Saving…" : "Save list"}</EButton>
            </>
          )}
        </>
      ) : <EButton variant="outline" onClick={onClose}>Close</EButton>}
    >
      <fieldset disabled={!canEdit || busy} className="min-w-0 space-y-3">
        <div className="flex flex-wrap gap-2">
          {selected.length === 0 ? <p className="text-[0.8125rem]">No properties opted out.</p> : selected.map((id) => (
            <span key={id} className="inline-flex min-h-9 items-center gap-2 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-3 text-[0.8125rem]">
              {names.get(id) ?? "Removed property"}
              {canEdit ? <button type="button" className="min-h-9 underline" aria-label={`Remove ${names.get(id) ?? "property"} from the list`} onClick={() => setDraft(selected.filter((value) => value !== id))}>Remove</button> : null}
            </span>
          ))}
        </div>
        {canEdit ? (
          <>
            <label className="block">
              <span className={AI_LABEL}>Find a property</span>
              <input className={AI_FIELD} value={query} placeholder="Name or suburb" onChange={(event) => setQuery(event.target.value)} />
            </label>
            {needle ? (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {matches.length === 0 ? <li className="text-[0.8125rem]">No matching property.</li> : matches.map((property) => (
                  <li key={property.id}>
                    <label className="flex min-h-11 items-center gap-3 text-[0.8125rem]">
                      <input type="checkbox" className="h-5 w-5" checked={selected.includes(property.id)} onChange={(event) => setDraft(event.target.checked ? [...selected, property.id] : selected.filter((value) => value !== property.id))} />
                      <span className="min-w-0 break-words">{property.name}{property.suburb ? `, ${property.suburb}` : ""}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : <p className={cn("text-[0.75rem]", AI_MUTED)}>Only administrators can change this list.</p>}
        {message ? <p role={message.tone === "bad" ? "alert" : "status"} className="text-[0.8125rem]">{message.text}</p> : null}
      </fieldset>
    </EActionDialog>
  );
}
