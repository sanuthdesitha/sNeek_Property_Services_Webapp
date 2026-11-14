"use client";

/** Steps 7–11: cleaning scope and form, photos per room, pricing and rates, calendar links, house rules and hazards. */
import * as React from "react";
import { Camera, ChevronDown, Plus, Trash2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField } from "@/components/v2/admin/estate-kit";
import { EToneNotice, ETonePill } from "@/components/v2/ui/tone-band";
import { PropertyChecklistProfile } from "@/components/v2/admin/properties/property-checklist-profile";
import { ONBOARDING_JOB_TYPES } from "@/lib/onboarding/workspace/sections";
import { jobTypeLabel, mainJobType } from "@/lib/onboarding/workspace/readiness";
import type { OnboardingRate, OnboardingRoomPhoto } from "@/lib/onboarding/workspace/types";
import type { CalendarValues, PhotosValues, PricingValues, RulesValues, ScopeValues, SpecialRequestValue } from "@/lib/onboarding/workspace/values";
import { useSectionDraft } from "./use-onboarding-workspace";
import { AutoTextField, ONB_INPUT_CLASS, onbInput, ONB_MUTED, PillToggle, newLocalId, numberText, parseNumberInput } from "./onboarding-kit";
import { uploadOfficePhoto } from "./steps-access";
import type { StepProps } from "./steps-property";

type Estimate = { estimatedHours: number; suggestedCleanerCount: number; estimatedPrice: number; warnings: string[] };

/** The existing estimator, asked with this onboarding's facts. A suggestion only: nothing is filled in. */
function useEstimate(input: Record<string, unknown> | null) {
  const [estimate, setEstimate] = React.useState<{ state: "idle" | "loading" | "failed" } | { state: "ok"; value: Estimate }>({ state: "idle" });
  const key = JSON.stringify(input);
  React.useEffect(() => {
    if (!input) return;
    const controller = new AbortController();
    setEstimate({ state: "loading" });
    fetch("/api/admin/onboarding/estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !body || typeof body.estimatedHours !== "number") throw new Error("estimate");
        setEstimate({ state: "ok", value: body as Estimate });
      })
      .catch(() => { if (!controller.signal.aborted) setEstimate({ state: "failed" }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return estimate;
}

function estimateInput(view: StepProps<unknown>["view"]): Record<string, unknown> {
  const { rooms, basics, scope, laundry } = view.values;
  return {
    bedrooms: rooms.bedrooms,
    bathrooms: rooms.bathrooms,
    hasBalcony: rooms.hasBalcony,
    floorCount: basics.floorCount,
    propertyType: basics.propertyType || null,
    sizeSqm: basics.sizeSqm,
    applianceCount: rooms.appliances.length,
    specialRequestCount: scope.specialRequests.length,
    conditionLevel: "standard",
    selectedJobTypes: scope.selectedJobTypes,
    laundryEnabled: laundry.hasLaundry === true,
  };
}

export function ScopeStep({ view, values, send, surveyId }: StepProps<ScopeValues> & { surveyId: string }) {
  const { draft, set, commit, setAndCommit } = useSectionDraft<ScopeValues>(values, send);
  const [checklistOpen, setChecklistOpen] = React.useState(false);
  const [checklistMounted, setChecklistMounted] = React.useState(false);
  const estimate = useEstimate(estimateInput(view));
  const toggleType = (jobType: string) => setAndCommit("selectedJobTypes", draft.selectedJobTypes.includes(jobType) ? draft.selectedJobTypes.filter((value) => value !== jobType) : [...draft.selectedJobTypes, jobType]);
  const updateRequest = (index: number, patch: Partial<SpecialRequestValue>) => set("specialRequests", draft.specialRequests.map((request, i) => (i === index ? { ...request, ...patch } : request)));
  const commitRequests = () => commit("specialRequests", draft.specialRequests.filter((request) => request.description.trim()));
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p id="job-types-label" className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Job types * (the first ticked is the main one)</p>
        <div role="group" aria-labelledby="job-types-label" className="flex flex-wrap gap-2">
          {ONBOARDING_JOB_TYPES.map((jobType) => (
            <PillToggle key={jobType} pressed={draft.selectedJobTypes.includes(jobType)} onClick={() => toggleType(jobType)}>
              {jobTypeLabel(jobType)}{draft.selectedJobTypes[0] === jobType ? " · main" : ""}
            </PillToggle>
          ))}
        </div>
      </div>
      <section aria-labelledby="special-requests" className="space-y-2">
        <h3 id="special-requests" className="text-[0.8125rem] font-[600]">Special requests</h3>
        {draft.specialRequests.length === 0 ? <p className={ONB_MUTED}>None. Each request becomes a checklist task; high and urgent ones need a proof photo.</p> : null}
        {draft.specialRequests.map((request, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
            <input aria-label={`Request ${index + 1}`} className={ONB_INPUT_CLASS} value={request.description} placeholder="Descale the kettle every clean" onChange={(event) => updateRequest(index, { description: event.target.value })} onBlur={commitRequests} />
            <select aria-label={`Request ${index + 1} priority`} className={ONB_INPUT_CLASS} value={request.priority} onChange={(event) => { const next = draft.specialRequests.map((r, i) => (i === index ? { ...r, priority: event.target.value as SpecialRequestValue["priority"] } : r)); set("specialRequests", next); commit("specialRequests", next.filter((r) => r.description.trim())); }}>
              <option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
            </select>
            <input aria-label={`Request ${index + 1} area`} className={ONB_INPUT_CLASS} value={request.area} placeholder="Kitchen" onChange={(event) => updateRequest(index, { area: event.target.value })} onBlur={commitRequests} />
            <EButton variant="ghost" size="icon" aria-label={`Remove request ${index + 1}`} onClick={() => setAndCommit("specialRequests", draft.specialRequests.filter((_, i) => i !== index).filter((r) => r.description.trim()))}><Trash2 className="h-4 w-4" aria-hidden /></EButton>
          </div>
        ))}
        <EButton variant="outline" size="sm" onClick={() => set("specialRequests", [...draft.specialRequests, { description: "", priority: "NORMAL", area: "" }])}><Plus className="h-4 w-4" aria-hidden /> Add request</EButton>
      </section>
      <AutoTextField label="No-go areas" multiline value={draft.noGoAreas} placeholder="Owner's cupboard in the hallway stays locked" onChange={(v) => set("noGoAreas", v)} onCommit={() => commit("noGoAreas")} />
      <AutoTextField label="Notes for the ticked types" multiline value={draft.jobTypeNotes} onChange={(v) => set("jobTypeNotes", v)} onCommit={() => commit("jobTypeNotes")} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AutoTextField label="Hours per clean" inputMode="decimal" value={numberText(draft.estimatedHours)} onChange={(v) => set("estimatedHours", parseNumberInput(v))} onCommit={() => commit("estimatedHours")} />
        <AutoTextField label="Cleaners" inputMode="numeric" value={numberText(draft.estimatedCleanerCount)} onChange={(v) => set("estimatedCleanerCount", parseNumberInput(v))} onCommit={() => commit("estimatedCleanerCount")} />
        <div className="space-y-1.5">
          <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Estimate</p>
          <p className="text-[0.875rem]" role="status">
            {estimate.state === "ok" ? `${estimate.value.suggestedCleanerCount} cleaner${estimate.value.suggestedCleanerCount === 1 ? "" : "s"} · ${estimate.value.estimatedHours.toFixed(1)} h` : estimate.state === "failed" ? "Could not be worked out" : "Working out…"}
          </p>
        </div>
      </div>
      <section aria-labelledby="checklist-disclosure" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
        <h3 id="checklist-disclosure">
          <button type="button" aria-expanded={checklistOpen} aria-controls="checklist-panel" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-[0.875rem] font-[600]" onClick={() => { setChecklistOpen((open) => !open); setChecklistMounted(true); }}>
            <span>Checklist and preview {view.checklistReviewed ? <ETonePill tone="good">Reviewed</ETonePill> : <span className={ONB_MUTED}>· library defaults until saved</span>}</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${checklistOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </h3>
        <div id="checklist-panel" hidden={!checklistOpen} className="border-t border-[hsl(var(--e-border))] p-3">
          {checklistMounted ? <PropertyChecklistProfile propertyId={surveyId} apiBase={`/api/admin/onboarding/surveys/${surveyId}/checklist`} mode="survey" /> : null}
        </div>
      </section>
      <p className={ONB_MUTED}>Recurring schedule: {view.values.calendar.icalUrl ? "None, calendar-driven" : "None set"}.</p>
    </div>
  );
}

export function PhotosStep({ view, values, send }: StepProps<PhotosValues>) {
  const { draft, set, commit, setAndCommit } = useSectionDraft<PhotosValues>(values, send);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const update = (id: string, patch: Partial<OnboardingRoomPhoto>) => set("roomPhotos", draft.roomPhotos.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));
  const upload = async (slot: OnboardingRoomPhoto, file: File) => {
    setBusy(slot.id);
    setError(null);
    try {
      const photo = await uploadOfficePhoto(file);
      setAndCommit("roomPhotos", draft.roomPhotos.map((candidate) => (candidate.id === slot.id ? { ...candidate, photo, askedOfClient: false } : candidate)));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The photo was not uploaded.");
    } finally {
      setBusy(null);
    }
  };
  const addFromRooms = () => {
    const existing = new Set(draft.roomPhotos.map((slot) => slot.room.trim().toLowerCase()));
    const added = view.values.rooms.roomList.filter((room) => room.name.trim() && !existing.has(room.name.trim().toLowerCase())).map((room) => ({ id: newLocalId("photo"), room: room.name.trim(), caption: "", photo: null, askedOfClient: false }));
    if (added.length) setAndCommit("roomPhotos", [...draft.roomPhotos, ...added]);
  };
  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {draft.roomPhotos.length === 0 ? <p className={ONB_MUTED}>No reference photos yet. Add a slot per room, then a photo of how it should look.</p> : null}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {draft.roomPhotos.map((slot, index) => (
          <li key={slot.id} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
            {slot.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slot.photo.url} alt={`${slot.room || "Room"} reference`} className="aspect-[4/3] w-full rounded-[var(--e-radius-sm)] object-cover" />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-[var(--e-radius-sm)] border border-dashed border-[hsl(var(--e-border-strong))] text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {slot.askedOfClient ? `${slot.room || "Room"}: waiting on client` : "No photo yet"}
              </div>
            )}
            {slot.photo?.source === "CLIENT_SUBMITTED" ? <ETonePill tone="info">From client</ETonePill> : null}
            <input aria-label={`Photo ${index + 1} room`} className={ONB_INPUT_CLASS} value={slot.room} placeholder="Bedroom 1" onChange={(event) => update(slot.id, { room: event.target.value })} onBlur={() => commit("roomPhotos")} />
            <input aria-label={`Photo ${index + 1} what to match`} className={ONB_INPUT_CLASS} value={slot.caption} placeholder="Bed made, 4 cushions" onChange={(event) => update(slot.id, { caption: event.target.value })} onBlur={() => commit("roomPhotos")} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] focus-within:ring-2 focus-within:ring-[hsl(var(--e-ring))]">
                <Camera className="h-4 w-4" aria-hidden /> {busy === slot.id ? "Uploading…" : slot.photo ? "Replace" : "Photo"}
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy === slot.id} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(slot, file); }} />
              </label>
              <label className="inline-flex min-h-11 items-center gap-2 text-[0.8125rem]">
                <input type="checkbox" checked={slot.askedOfClient} onChange={(event) => setAndCommit("roomPhotos", draft.roomPhotos.map((candidate) => (candidate.id === slot.id ? { ...candidate, askedOfClient: event.target.checked } : candidate)))} />
                Ask the client
              </label>
              <EButton className="ml-auto" variant="ghost" size="icon" aria-label={`Remove ${slot.room || `photo ${index + 1}`}`} onClick={() => setAndCommit("roomPhotos", draft.roomPhotos.filter((candidate) => candidate.id !== slot.id))}><Trash2 className="h-4 w-4" aria-hidden /></EButton>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <EButton variant="outline" size="sm" onClick={() => setAndCommit("roomPhotos", [...draft.roomPhotos, { id: newLocalId("photo"), room: "", caption: "", photo: null, askedOfClient: false }])}><Plus className="h-4 w-4" aria-hidden /> Add room photo</EButton>
        {view.values.rooms.roomList.length ? <EButton variant="ghost" size="sm" onClick={addFromRooms}>Add a slot for each listed room</EButton> : null}
      </div>
      <p className={ONB_MUTED}>Each becomes a reference position in the property&apos;s setup guide, so the cleaner can match the listing photo. Uploads keep the original; a client upload is marked &quot;from client&quot;.</p>
    </div>
  );
}

function emptyRate(jobType: string): OnboardingRate {
  return { jobType, clientRate: null, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: null };
}

export function PricingStep({ view, values, send }: StepProps<PricingValues>) {
  const jobTypes = view.values.scope.selectedJobTypes;
  const merged = jobTypes.map((jobType) => values.rates.find((rate) => rate.jobType === jobType) ?? emptyRate(jobType));
  const { draft, set, commit, setAndCommit } = useSectionDraft<PricingValues>({ rates: merged }, send);
  const rows = jobTypes.map((jobType) => draft.rates.find((rate) => rate.jobType === jobType) ?? emptyRate(jobType));
  const estimate = useEstimate(jobTypes.length ? estimateInput(view) : null);
  const main = mainJobType(jobTypes);
  const updateRate = (jobType: string, patch: Partial<OnboardingRate>) => {
    const others = draft.rates.filter((rate) => rate.jobType !== jobType);
    const current = rows.find((rate) => rate.jobType === jobType) ?? emptyRate(jobType);
    return [...others, { ...current, ...patch }];
  };
  if (jobTypes.length === 0) return <EToneNotice tone="attention" title="Tick a job type first">Rates are set per job type. Tick the job types on the Cleaning scope step.</EToneNotice>;
  return (
    <div className="space-y-4">
      <div role="region" aria-label="Rates" tabIndex={0} className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
        <table className="w-full min-w-[36rem] text-[0.8125rem]">
          <thead className="bg-[hsl(var(--e-surface-raised))] text-left text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            <tr><th className="px-3 py-2 font-[550]">Job type</th><th className="px-3 py-2 font-[550]">Client rate, ex GST</th><th className="px-3 py-2 font-[550]">Billing</th><th className="px-3 py-2 font-[550]">Cleaner pay</th></tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--e-border))]">
            {rows.map((rate) => {
              const missing = rate.clientRate === null;
              return (
                <tr key={rate.jobType}>
                  <td className={`px-3 py-2 ${missing && rate.jobType === main ? "bg-[hsl(var(--e-band-problem-bg))] text-[hsl(var(--e-band-problem-fg))]" : ""}`}>{jobTypeLabel(rate.jobType)}{rate.jobType === main ? " · main" : ""}</td>
                  <td className="px-3 py-2">
                    <input aria-label={`${jobTypeLabel(rate.jobType)} client rate`} aria-describedby={missing ? `rate-missing-${rate.jobType}` : undefined} inputMode="decimal" className={onbInput("w-28")} value={numberText(rate.clientRate)} placeholder="0.00" onChange={(event) => set("rates", updateRate(rate.jobType, { clientRate: parseNumberInput(event.target.value) }))} onBlur={() => commit("rates")} />
                    {missing ? <p id={`rate-missing-${rate.jobType}`} className="mt-1 text-[0.75rem] text-[hsl(var(--e-danger))]">No rate yet</p> : null}
                  </td>
                  <td className="px-3 py-2">
                    <select aria-label={`${jobTypeLabel(rate.jobType)} billing`} className={onbInput("w-28")} value={rate.billingUnit} onChange={(event) => setAndCommit("rates", updateRate(rate.jobType, { billingUnit: event.target.value as OnboardingRate["billingUnit"] }))}>
                      <option value="PER_JOB">Per job</option><option value="PER_HOUR">Per hour</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <select aria-label={`${jobTypeLabel(rate.jobType)} cleaner pay basis`} className={onbInput("w-32")} value={rate.cleanerPayMode} onChange={(event) => setAndCommit("rates", updateRate(rate.jobType, { cleanerPayMode: event.target.value as OnboardingRate["cleanerPayMode"] }))}>
                        <option value="PER_CLEAN">Per clean</option><option value="HOURLY">Hourly</option>
                      </select>
                      <input aria-label={`${jobTypeLabel(rate.jobType)} cleaner pay`} inputMode="decimal" className={onbInput("w-24")} value={numberText(rate.cleanerPay)} placeholder="Not set" onChange={(event) => set("rates", updateRate(rate.jobType, { cleanerPay: parseNumberInput(event.target.value) }))} onBlur={() => commit("rates")} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <EToneNotice tone="info">
        {estimate.state === "ok"
          ? `Estimate from ${view.values.rooms.bedrooms} bed, ${view.values.rooms.bathrooms} bath, ${estimate.value.estimatedHours.toFixed(1)} h: $${estimate.value.estimatedPrice.toFixed(2)}. It is only a suggestion; nothing is filled in for you.`
          : estimate.state === "failed" ? "The estimate could not be worked out." : "Working out an estimate…"}{" "}
        Without a rate the turnover can still be cleaned, but the invoice generator refuses this client until one is set. Activation needs a rate for the main job type.
      </EToneNotice>
      <p className={ONB_MUTED}>Per-clean cleaner pay for the main job type is saved on the property. Hourly pay is not stored on the property; the cleaner&apos;s own rate applies.</p>
    </div>
  );
}

export function CalendarStep({ values, send }: StepProps<CalendarValues>) {
  const { draft, set, commit, setAndCommit } = useSectionDraft<CalendarValues>(values, send);
  const [check, setCheck] = React.useState<{ state: "idle" | "checking" } | { state: "ok"; count: number } | { state: "failed"; message: string }>({ state: "idle" });
  const urlValid = !draft.icalUrl || /^https?:\/\//i.test(draft.icalUrl.trim());
  const runCheck = async () => {
    setCheck({ state: "checking" });
    try {
      const response = await fetch("/api/admin/onboarding/ical/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ icalUrl: draft.icalUrl.trim() }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.valid !== true) setCheck({ state: "failed", message: body.error ?? "The link could not be read." });
      else setCheck({ state: "ok", count: Number(body.eventCount) || 0 });
    } catch {
      setCheck({ state: "failed", message: "No connection. Try again." });
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <EField label="Channel">
          <select className={ONB_INPUT_CLASS} value={draft.icalProvider} onChange={(event) => setAndCommit("icalProvider", event.target.value)}>
            <option value="ICAL_OTHER">Airbnb or other iCal</option>
            <option value="ICAL_HOSPITABLE">Hospitable</option>
          </select>
        </EField>
        <AutoTextField label="iCal link" type="url" value={draft.icalUrl} placeholder="https://www.airbnb.com.au/calendar/ical/…" onChange={(v) => set("icalUrl", v)} onCommit={() => { if (urlValid) commit("icalUrl", draft.icalUrl.trim()); }} />
        <EButton variant="outline" disabled={!draft.icalUrl.trim() || !urlValid || check.state === "checking"} onClick={() => void runCheck()}>{check.state === "checking" ? "Checking…" : "Check again"}</EButton>
      </div>
      {!urlValid ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Use a web link starting with https://. Not saved yet.</p> : null}
      {check.state === "ok" ? <EToneNotice tone="good">Read {check.count} booking{check.count === 1 ? "" : "s"}. Nothing is created until the property is activated, and the link is saved switched off.</EToneNotice> : null}
      {check.state === "failed" ? <EToneNotice tone="problem" role="alert">{check.message}</EToneNotice> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <EField label="Job times from">
          <select className={ONB_INPUT_CLASS} value={draft.jobTimeSource} onChange={(event) => setAndCommit("jobTimeSource", event.target.value as CalendarValues["jobTimeSource"])}>
            <option value="PROPERTY">Property times</option>
            <option value="ICAL">Calendar event times</option>
          </select>
        </EField>
        <AutoTextField label="Checkout" type="time" value={draft.defaultCheckoutTime} onChange={(v) => set("defaultCheckoutTime", v)} onCommit={() => commit("defaultCheckoutTime")} />
        <AutoTextField label="Check-in" type="time" value={draft.defaultCheckinTime} onChange={(v) => set("defaultCheckinTime", v)} onCommit={() => commit("defaultCheckinTime")} />
      </div>
      <p className={ONB_MUTED}>One calendar per property today. Stayz and direct bookings need a combined feed from the channel manager; adding a second link is not offered. Empty times use 10:00 checkout and 14:00 check-in.</p>
    </div>
  );
}

export function RulesStep({ values, send }: StepProps<RulesValues>) {
  const { draft, set, commit, setAndCommit } = useSectionDraft<RulesValues>(values, send);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <AutoTextField label="Hazards" multiline value={draft.hazards} placeholder="Steep driveway when wet" onChange={(v) => set("hazards", v)} onCommit={() => commit("hazards")} />
      <AutoTextField label="Building rules" multiline value={draft.buildingRules} placeholder="Strata: no vacuuming before 08:00" onChange={(v) => set("buildingRules", v)} onCommit={() => commit("buildingRules")} />
      <EField label="Pets">
        <select className={ONB_INPUT_CLASS} value={draft.hasPets ? "yes" : "no"} onChange={(event) => setAndCommit("hasPets", event.target.value === "yes")}>
          <option value="no">No pets</option>
          <option value="yes">Pets live or stay here</option>
        </select>
      </EField>
      {draft.hasPets ? <AutoTextField label="Pet details" value={draft.petDetails} onChange={(v) => set("petDetails", v)} onCommit={() => commit("petDetails")} /> : <div className="max-md:hidden" />}
      <AutoTextField label="Bins" value={draft.binDay} placeholder="Tue general, alt Wed recycling" onChange={(v) => set("binDay", v)} onCommit={() => commit("binDay")} />
      <AutoTextField label="Parking" value={draft.parkingInstructions} placeholder="Visitor bay 3" onChange={(v) => set("parkingInstructions", v)} onCommit={() => commit("parkingInstructions")} />
      <AutoTextField className="md:col-span-2" label="Other notes for the team" multiline value={draft.specialNotes} onChange={(v) => set("specialNotes", v)} onCommit={() => commit("specialNotes")} />
      <p className={`${ONB_MUTED} md:col-span-2`}>Hazards and rules reach the cleaner&apos;s access guide and the property notes on activation; pets, bins and parking as they do today.</p>
    </div>
  );
}
