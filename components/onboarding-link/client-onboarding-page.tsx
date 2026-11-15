"use client";

/**
 * The client's own onboarding link (board "M-PropertyOnboarding", frame 6):
 * only the parts the office ticked, saved as they type, marked "from client".
 * "I'm finished" tells the office in its inbox and activates nothing. A
 * refused link shows one sentence and nothing else.
 */
import * as React from "react";
import { Camera, Check, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, E_INPUT_CLASS } from "@/components/v2/admin/estate-kit";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import type { ClientLinkSection } from "@/lib/onboarding/workspace/sections";

type PageView = {
  companyName: string;
  officePhone: string | null;
  clientName: string | null;
  propertyName: string;
  askedByName: string | null;
  expiresAt: string;
  finishedAt: string | null;
  sections: Array<{ key: ClientLinkSection; label: string; done: boolean }>;
  access?: { officeEntryCount: number; entries: ClientAccessEntry[] };
  photos?: { slots: Array<{ id: string; room: string; caption: string; officePhoto: boolean; clientPhoto: { url: string; key: string } | null }> };
  rules?: { hazards: string; buildingRules: string; hasPets: boolean; petDetails: string; binDay: string; parkingInstructions: string };
  linen?: { linenSets: number | null; linenBufferSets: number | null };
  calendar?: { hasCalendarLink: boolean };
};

type ClientAccessEntry = { id: string; kind: string; where: string; hasCode: boolean; photos: Array<{ url: string; key: string }>; code?: string };

const INPUT = cn(E_INPUT_CLASS, "h-11 text-base");
const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";
const TIMEZONE = "Australia/Sydney";
const KIND_LABELS: Record<string, string> = { LOCKBOX: "Lockbox", KEYS: "Keys", ENTRY: "Building entry", ALARM: "Alarm", PARKING: "Parking", WIFI: "Wifi", OTHER: "Other" };

function localId(): string {
  return `c-${Math.random().toString(36).slice(2, 12)}`;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "failed"; message: string };

export function ClientOnboardingPage({ token }: { token: string }) {
  const [view, setView] = React.useState<PageView | null>(null);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<ClientLinkSection | null>(null);
  const [save, setSave] = React.useState<SaveState>({ kind: "idle" });
  const [finishing, setFinishing] = React.useState(false);
  const [finishError, setFinishError] = React.useState<string | null>(null);
  const failedRef = React.useRef<unknown>(null);
  const chainRef = React.useRef<Promise<void>>(Promise.resolve());

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const response = await fetch(`/api/public/onboarding-link/${encodeURIComponent(token)}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (response.status === 404 || response.status === 410) {
        setRefusal(typeof body?.error === "string" ? body.error : "This link is no longer active. Contact the office.");
        return;
      }
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "The page could not be loaded.");
      setView(body as PageView);
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : "The page could not be loaded.");
    }
  }, [token]);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const send = React.useCallback((body: unknown) => {
    chainRef.current = chainRef.current.then(async () => {
      setSave({ kind: "saving" });
      try {
        const response = await fetch(`/api/public/onboarding-link/${encodeURIComponent(token)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const answer = await response.json().catch(() => null);
        if (response.status === 404 || response.status === 410) {
          setRefusal(typeof answer?.error === "string" ? answer.error : "This link is no longer active. Contact the office.");
          return;
        }
        if (!response.ok) {
          failedRef.current = body;
          setSave({ kind: "failed", message: typeof answer?.error === "string" ? answer.error : "Not saved." });
          return;
        }
        failedRef.current = null;
        setSave({ kind: "saved", at: answer.savedAt });
      } catch {
        failedRef.current = body;
        setSave({ kind: "failed", message: "No connection. Your answers stay on this screen." });
      }
    });
  }, [token]);

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      const response = await fetch(`/api/public/onboarding-link/${encodeURIComponent(token)}`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "The office was not told yet.");
      setView((current) => (current ? { ...current, finishedAt: body.finishedAt } : current));
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : "The office was not told yet.");
    } finally {
      setFinishing(false);
    }
  };

  if (refusal) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="e-display-md">Link not active</h1>
        <p className="mt-3">{refusal}</p>
      </main>
    );
  }
  if (loadError && !view) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="e-display-md">Property details</h1>
        <EToneNotice tone="problem" role="alert" className="mt-4">{loadError} <button type="button" className="font-[600] underline" onClick={() => void load()}>Try again</button></EToneNotice>
      </main>
    );
  }
  if (!view) return <main className="mx-auto max-w-lg px-4 py-16"><p role="status" className={MUTED}>Loading…</p></main>;

  const done = view.sections.filter((section) => section.done).length;
  const nextOpen = view.sections.find((section) => !section.done);
  const saveChip = save.kind === "saving" ? "Saving…" : save.kind === "saved" ? `✓ Saved ${formatInTimeZone(new Date(save.at), TIMEZONE, "HH:mm")}` : save.kind === "failed" ? "Not saved" : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3">
        <span className="font-serif text-[1.25rem]">{view.companyName}</span>
        <span className={MUTED}>{view.clientName ? `for ${view.clientName}` : ""}</span>
      </header>
      <main className="flex-1 space-y-4 px-4 py-5 pb-32">
        {open === null ? (
          <>
            <div>
              <h1 className="e-display-md break-words">Help us get {view.propertyName} ready</h1>
              <p className={MUTED}>Asked by {view.askedByName ? `${view.askedByName}, ` : ""}{view.companyName} office · link works until {formatInTimeZone(new Date(view.expiresAt), TIMEZONE, "EEE d MMM")}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--e-muted))]" role="meter" aria-label="Parts done" aria-valuemin={0} aria-valuemax={view.sections.length} aria-valuenow={done}>
                <div className="h-full bg-[hsl(var(--e-primary))]" style={{ width: `${view.sections.length ? (done / view.sections.length) * 100 : 0}%` }} />
              </div>
              <span className={MUTED}>{done} of {view.sections.length} parts</span>
            </div>
            <ul className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3">
              {view.sections.map((section, index) => (
                <li key={section.key}>
                  <button type="button" className="flex min-h-12 w-full items-center gap-3 text-left" onClick={() => setOpen(section.key)}>
                    <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full text-[0.75rem]", section.done ? "bg-[hsl(var(--e-band-good-bg))] text-[hsl(var(--e-band-good-fg))]" : "bg-[hsl(var(--e-muted))]")}>
                      {section.done ? <Check className="h-4 w-4" aria-label="Done" /> : index + 1}
                    </span>
                    <span className={cn("flex-1", !section.done && "font-[600]")}>{section.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            <EToneNotice tone="info">Your answers save as you type. You can close this page and come back with the same link.</EToneNotice>
            {view.finishedAt ? (
              <EToneNotice tone="good" role="status" title="Thank you">The office has been told you finished. You can still change your answers until the link expires.</EToneNotice>
            ) : (
              <div className="space-y-2">
                <EButton variant="outline" className="w-full" disabled={finishing || save.kind === "saving"} onClick={() => void finish()}>{finishing ? "Telling the office…" : "I'm finished"}</EButton>
                <p className={MUTED}>This tells the office in its inbox. It does not activate anything.</p>
                {finishError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{finishError}</p> : null}
              </div>
            )}
          </>
        ) : (
          <section aria-labelledby="part-title" className="space-y-4">
            <div className="flex items-center gap-2">
              <EButton variant="outline" size="icon" aria-label="Back to all parts" onClick={() => { setOpen(null); void load(); }}><ChevronLeft className="h-5 w-5" aria-hidden /></EButton>
              <h1 id="part-title" className="flex-1 text-[1.125rem] font-[600]">{view.sections.find((section) => section.key === open)?.label}</h1>
              {saveChip ? <span role="status" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{saveChip}</span> : null}
            </div>
            {save.kind === "failed" ? (
              <EToneNotice tone="problem" role="alert">{save.message} <button type="button" className="font-[600] underline" onClick={() => failedRef.current && send(failedRef.current)}>Try again</button></EToneNotice>
            ) : null}
            {open === "access" && view.access ? <AccessPart token={token} initial={view.access} send={send} /> : null}
            {open === "photos" && view.photos ? <PhotosPart token={token} initial={view.photos.slots} send={send} /> : null}
            {open === "rules" && view.rules ? <RulesPart initial={view.rules} send={send} /> : null}
            {open === "linen" && view.linen ? <LinenPart initial={view.linen} send={send} /> : null}
            {open === "calendar" && view.calendar ? <CalendarPart initial={view.calendar} send={send} /> : null}
          </section>
        )}
      </main>
      <footer className="fixed inset-x-0 bottom-0 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3">
        <div className="mx-auto max-w-2xl space-y-1 text-center">
          {open === null && nextOpen ? <EButton className="w-full" onClick={() => setOpen(nextOpen.key)}>Continue: {nextOpen.label.toLowerCase()}</EButton> : null}
          {open !== null ? <EButton className="w-full" onClick={() => { setOpen(null); void load(); }}>Done with this part</EButton> : null}
          <p className={MUTED}>{view.officePhone ? `Questions? Call the office on ${view.officePhone}` : "Questions? Contact the office."}</p>
        </div>
      </footer>
    </div>
  );
}

async function uploadClientPhoto(token: string, file: File): Promise<{ url: string; key: string }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`/api/public/onboarding-link/${encodeURIComponent(token)}/photo`, { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The photo was not added.");
  return { url: body.url, key: body.key };
}

function AccessPart({ token, initial, send }: { token: string; initial: NonNullable<PageView["access"]>; send: (body: unknown) => void }) {
  const [entries, setEntries] = React.useState<ClientAccessEntry[]>(initial.entries);
  const entriesRef = React.useRef(entries);
  entriesRef.current = entries;
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const push = (next: ClientAccessEntry[]) => {
    send({ section: "access", entries: next.map((entry) => ({ id: entry.id, kind: entry.kind, where: entry.where, photos: entry.photos, ...(entry.code !== undefined ? { code: entry.code } : {}) })) });
    setEntries(next.map((entry) => (entry.code !== undefined ? { ...entry, hasCode: Boolean(entry.code.trim()), code: undefined } : entry)));
  };
  const update = (id: string, patch: Partial<ClientAccessEntry>) => setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  return (
    <div className="space-y-3">
      {initial.officeEntryCount > 0 ? <p className={MUTED}>The office already has {initial.officeEntryCount} access detail{initial.officeEntryCount === 1 ? "" : "s"}. Add anything missing below.</p> : null}
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {entries.map((entry, index) => (
        <div key={entry.id} className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
          <div className="flex items-center gap-2">
            <select aria-label={`Detail ${index + 1} kind`} className={cn(INPUT, "w-auto")} value={entry.kind} onChange={(event) => push(entriesRef.current.map((candidate) => (candidate.id === entry.id ? { ...candidate, kind: event.target.value } : candidate)))}>
              {Object.entries(KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
            </select>
            <EButton className="ml-auto" variant="ghost" size="icon" aria-label={`Remove detail ${index + 1}`} onClick={() => push(entriesRef.current.filter((candidate) => candidate.id !== entry.id))}><Trash2 className="h-4 w-4" aria-hidden /></EButton>
          </div>
          <EField label="Where and how">
            <input className={INPUT} value={entry.where} placeholder="Side gate, left of the letterboxes" onChange={(event) => update(entry.id, { where: event.target.value })} onBlur={() => push(entriesRef.current)} />
          </EField>
          <EField label="Code" hint={entry.hasCode ? "A code is saved (encrypted). Type a new one to replace it." : "Saved encrypted; the office checks it before use."}>
            <input className={INPUT} type="password" autoComplete="off" value={entry.code ?? ""} placeholder={entry.hasCode ? "••••" : "Optional"} onChange={(event) => update(entry.id, { code: event.target.value })} onBlur={() => { if (entriesRef.current.find((candidate) => candidate.id === entry.id)?.code !== undefined) push(entriesRef.current); }} />
          </EField>
          <div className="flex flex-wrap items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {entry.photos.map((photo) => <img key={photo.key} src={photo.url} alt="Access photo" className="h-16 w-16 rounded-[var(--e-radius)] object-cover" />)}
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem]">
              <Camera className="h-4 w-4" aria-hidden /> {busy === entry.id ? "Adding…" : "Photo"}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setBusy(entry.id);
                setError(null);
                try {
                  const photo = await uploadClientPhoto(token, file);
                  push(entriesRef.current.map((candidate) => (candidate.id === entry.id ? { ...candidate, photos: [...candidate.photos, photo] } : candidate)));
                } catch (uploadError) {
                  setError(uploadError instanceof Error ? uploadError.message : "The photo was not added.");
                } finally {
                  setBusy(null);
                }
              }} />
            </label>
          </div>
        </div>
      ))}
      <EButton variant="outline" className="w-full" onClick={() => setEntries((current) => [...current, { id: localId(), kind: current.length ? "ENTRY" : "LOCKBOX", where: "", hasCode: false, photos: [] }])}><Plus className="h-4 w-4" aria-hidden /> Add lockbox, keys, entry or other</EButton>
      <p className={MUTED}>Never put a code in a photo. Codes are only shown to the cleaner on the job, from accepting it until the day after the clean.</p>
    </div>
  );
}

function PhotosPart({ token, initial, send }: { token: string; initial: NonNullable<PageView["photos"]>["slots"]; send: (body: unknown) => void }) {
  const [slots, setSlots] = React.useState(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (slots.length === 0) return <p className={MUTED}>The office has not listed any rooms to photograph yet.</p>;
  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <p className={MUTED}>A photo of each room as guests should find it, so the cleaner can match it.</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {slots.map((slot) => (
          <li key={slot.id} className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
            <p className="font-[600]">{slot.room || "Room"}</p>
            {slot.caption ? <p className={MUTED}>{slot.caption}</p> : null}
            {slot.officePhoto ? <p className={MUTED}>The office already has a photo of this room.</p> : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {slot.clientPhoto ? <img src={slot.clientPhoto.url} alt={`${slot.room} photo`} className="aspect-[4/3] w-full rounded-[var(--e-radius)] object-cover" /> : null}
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.875rem]">
                  <Camera className="h-4 w-4" aria-hidden /> {busy === slot.id ? "Adding…" : slot.clientPhoto ? "Replace photo" : "Add photo"}
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setBusy(slot.id);
                    setError(null);
                    try {
                      const photo = await uploadClientPhoto(token, file);
                      setSlots((current) => current.map((candidate) => (candidate.id === slot.id ? { ...candidate, clientPhoto: photo } : candidate)));
                      send({ section: "photos", photos: [{ id: slot.id, photo }] });
                    } catch (uploadError) {
                      setError(uploadError instanceof Error ? uploadError.message : "The photo was not added.");
                    } finally {
                      setBusy(null);
                    }
                  }} />
                </label>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RulesPart({ initial, send }: { initial: NonNullable<PageView["rules"]>; send: (body: unknown) => void }) {
  const [values, setValues] = React.useState(initial);
  const sentRef = React.useRef(initial);
  const commit = (key: keyof typeof initial, value = values[key]) => {
    if (sentRef.current[key] === value) return;
    sentRef.current = { ...sentRef.current, [key]: value };
    send({ section: "rules", values: { [key]: value } });
  };
  const text = (key: "hazards" | "buildingRules" | "petDetails" | "binDay" | "parkingInstructions", label: string, multiline = false) => (
    <EField label={label}>
      {multiline ? (
        <textarea className={cn(INPUT, "h-auto min-h-[5rem] py-2")} value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => commit(key)} />
      ) : (
        <input className={INPUT} value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => commit(key)} />
      )}
    </EField>
  );
  return (
    <div className="space-y-3">
      {text("hazards", "Hazards the cleaner should know", true)}
      {text("buildingRules", "Building or strata rules", true)}
      <EField label="Pets">
        <select className={INPUT} value={values.hasPets ? "yes" : "no"} onChange={(event) => { const hasPets = event.target.value === "yes"; setValues((current) => ({ ...current, hasPets })); commit("hasPets", hasPets); }}>
          <option value="no">No pets</option><option value="yes">Pets live or stay here</option>
        </select>
      </EField>
      {values.hasPets ? text("petDetails", "Pet details") : null}
      {text("binDay", "Bin days")}
      {text("parkingInstructions", "Parking for the cleaner")}
    </div>
  );
}

function LinenPart({ initial, send }: { initial: NonNullable<PageView["linen"]>; send: (body: unknown) => void }) {
  const [values, setValues] = React.useState({ linenSets: initial.linenSets === null ? "" : String(initial.linenSets), linenBufferSets: initial.linenBufferSets === null ? "" : String(initial.linenBufferSets) });
  const commit = (key: "linenSets" | "linenBufferSets") => {
    const raw = values[key].trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 500)) return;
    send({ section: "linen", values: { [key]: value } });
  };
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <EField label="Linen sets at the property"><input className={INPUT} inputMode="numeric" value={values.linenSets} onChange={(event) => setValues((current) => ({ ...current, linenSets: event.target.value }))} onBlur={() => commit("linenSets")} /></EField>
      <EField label="Spare sets"><input className={INPUT} inputMode="numeric" value={values.linenBufferSets} onChange={(event) => setValues((current) => ({ ...current, linenBufferSets: event.target.value }))} onBlur={() => commit("linenBufferSets")} /></EField>
    </div>
  );
}

function CalendarPart({ initial, send }: { initial: NonNullable<PageView["calendar"]>; send: (body: unknown) => void }) {
  const [url, setUrl] = React.useState("");
  const valid = !url.trim() || /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <div className="space-y-3">
      {initial.hasCalendarLink ? <p className={MUTED}>A calendar link is already saved. Paste a new one only to replace it.</p> : null}
      <EField label="Calendar (iCal) link from Airbnb or your channel manager">
        <input className={INPUT} type="url" value={url} placeholder="https://…" onChange={(event) => setUrl(event.target.value)} onBlur={() => { if (url.trim() && valid) send({ section: "calendar", icalUrl: url.trim() }); }} />
      </EField>
      {!valid ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Paste a web link starting with https://</p> : null}
    </div>
  );
}
