"use client";

/**
 * "For you to arrange" on the client Maintenance page (client-handled
 * maintenance, 2026-11-18). Items the office handed to the client, with the
 * office's note, the description and photos. The client (or an assistant with
 * the maintenance permission) accepts or hands it back with a reason, records
 * their own tradesperson and a planned window, and marks it done with a note
 * and photos, or "could not be done" with a reason.
 *
 *   GET  /api/client/maintenance/handled
 *   POST /api/client/maintenance/handled/:id   { action, …, expectedVersion }
 *   POST /api/uploads/direct (folder "maintenance")  photo upload
 *
 * Forms open in lazy disclosures, keep their drafts while folded and after a
 * failed save, freeze while saving, and reset when the item changes (each card
 * is keyed by item). Late answers for an earlier read are ignored.
 */
import * as React from "react";
import { ChevronDown, Upload, X } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { MediaGallery } from "@/components/shared/media-gallery";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";
import { CLIENT_FACING_LABELS } from "@/lib/maintenance/client-handling-rules";
import { TRADESPERSON_ACCESS_LABELS, TRADESPERSON_ACCESS_METHODS } from "@/lib/maintenance/client-tradesperson";
import type { ClientHandledItemView, ClientHandlingPhoto } from "@/lib/maintenance/client-handling-types";
import type { VisitAccessMethod } from "@/lib/maintenance/visit-plan";
import { toast } from "@/hooks/use-toast";

type ListState = { items: ClientHandledItemView[] | null; error: string | null; loading: boolean };

const FIELD = "w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem] focus:border-[hsl(var(--e-gold))] focus:outline-none max-sm:text-base";
const LABEL = "text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]";

function when(iso: string | null, timeZone: string, pattern = "EEE d MMM HH:mm"): string {
  if (!iso) return "Not recorded";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Not recorded" : formatInTimeZone(date, timeZone, pattern);
}

async function act(itemId: string, body: Record<string, unknown>): Promise<ClientHandledItemView> {
  let response: Response;
  try {
    response = await fetch(`/api/client/maintenance/handled/${encodeURIComponent(itemId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Could not reach the server. Check the connection and try again.");
  }
  const parsed = (await response.json().catch(() => ({}))) as { item?: ClientHandledItemView; error?: string };
  if (!response.ok || !parsed.item) throw new Error(parsed.error || "That could not be saved. Your entry is kept; try again.");
  return parsed.item;
}

function Disclosure({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="border-t border-[hsl(var(--e-border))] pt-1">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-[0.875rem] font-[600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
        {label}
        <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {/* Mounted while folded so a draft survives. */}
      <div id={id} hidden={!open} className={cn("flex-col gap-2 pb-1", open ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}

type TradespersonDraft = { name: string; phone: string; trade: string; company: string; note: string; plannedDate: string; startTime: string; endTime: string; accessMethod: VisitAccessMethod };

function draftFrom(item: ClientHandledItemView, timeZone: string): TradespersonDraft {
  const person = item.tradesperson;
  return {
    name: person?.name ?? "",
    phone: person?.phone ?? "",
    trade: person?.trade ?? "",
    company: person?.company ?? "",
    note: person?.note ?? "",
    plannedDate: person?.plannedStart ? when(person.plannedStart, timeZone, "yyyy-MM-dd") : "",
    startTime: person?.plannedStart ? when(person.plannedStart, timeZone, "HH:mm") : "",
    endTime: person?.plannedEnd ? when(person.plannedEnd, timeZone, "HH:mm") : "",
    accessMethod: person?.accessMethod ?? "CLIENT_MEETING",
  };
}

function TextField({ label, value, onChange, type = "text", required, maxLength, autoComplete }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; maxLength?: number; autoComplete?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className={LABEL}>{label}{required ? " (required)" : ""}</span>
      <input type={type} value={value} required={required} maxLength={maxLength} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} className={cn(FIELD, "h-11")} />
    </label>
  );
}

function usePhotoUploads() {
  const [photos, setPhotos] = React.useState<ClientHandlingPhoto[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "maintenance");
        const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = (await response.json().catch(() => ({}))) as { key?: string; url?: string; error?: string };
        if (!response.ok || !body.key) throw new Error(body.error ?? `Could not upload ${file.name}.`);
        setPhotos((current) => [...current, { key: String(body.key), url: String(body.url ?? "") }]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The upload did not finish.");
    } finally {
      setUploading(false);
    }
  }
  return { photos, uploading, error, upload, remove: (key: string) => setPhotos((current) => current.filter((photo) => photo.key !== key)), reset: () => setPhotos([]) };
}

function HandledItemCard({ initial, timeZone, onSaved }: { initial: ClientHandledItemView; timeZone: string; onSaved: (item: ClientHandledItemView) => void }) {
  const item = initial;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<"decline" | "done" | "notDone" | "clear" | null>(null);
  const [personOpen, setPersonOpen] = React.useState(false);
  const [doneOpen, setDoneOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<TradespersonDraft>(() => draftFrom(item, timeZone));
  const [doneNote, setDoneNote] = React.useState("");
  const uploads = usePhotoUploads();
  const headingId = React.useId();
  const set = (key: keyof TradespersonDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  async function send(body: Record<string, unknown>, success: string, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const saved = await act(item.id, { ...body, expectedVersion: item.version });
      after?.();
      setDialog(null);
      toast({ title: success });
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That could not be saved. Your entry is kept; try again.");
    } finally {
      setBusy(false);
    }
  }

  const person = item.tradesperson;
  const finished = !item.canAct;
  return (
    <ECard>
      <ECardBody className="space-y-2.5 p-4">
        <section aria-labelledby={headingId} aria-busy={busy} className="space-y-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 id={headingId} className="font-[600] [overflow-wrap:anywhere]">{item.title}</h3>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {item.property.name}
                {item.area ? ` · ${item.area}` : ""}
                {item.handedOverAt ? ` · asked ${when(item.handedOverAt, timeZone, "EEE d MMM")}` : ""}
              </p>
            </div>
            <EBadge tone={item.state === "DONE" ? "success" : item.canAct ? "warning" : "neutral"} soft>{item.closed && item.state !== "DONE" ? "Closed by our team" : CLIENT_FACING_LABELS[item.state]}</EBadge>
          </div>
          {item.officeNote ? <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.875rem]"><span className="font-[600]">Note from our team:</span> {item.officeNote}</p> : null}
          {item.description ? <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))] [overflow-wrap:anywhere]">{item.description}</p> : null}
          {item.photos.length > 0 ? <MediaGallery items={item.photos.map((photo) => ({ id: photo.key, url: photo.url }))} title={item.title} className="grid grid-cols-4 gap-2 sm:grid-cols-6" /> : null}

          {person ? (
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2 text-[0.8125rem]">
              <p><span className="font-[600]">Your tradesperson:</span> {person.name}{[person.trade, person.company].filter(Boolean).length ? ` · ${[person.trade, person.company].filter(Boolean).join(", ")}` : ""}{person.phone ? ` · ${person.phone}` : ""}</p>
              <p>{person.plannedStart ? `Planned ${when(person.plannedStart, timeZone)}${person.plannedEnd ? ` to ${when(person.plannedEnd, timeZone, "HH:mm")}` : ""}` : "No date yet"}</p>
              {person.plannedStart && person.accessMethod ? <p className="text-[hsl(var(--e-text-secondary))]">{TRADESPERSON_ACCESS_LABELS[person.accessMethod]}{person.onCleanersDay ? ". Our cleaner that day is told someone is coming." : "."}</p> : null}
              {person.updatedByName ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Saved {when(person.updatedAt, timeZone)} by {person.updatedByName}</p> : null}
            </div>
          ) : null}

          {item.response?.state === "DECLINED" ? <p className="text-[0.8125rem]">You handed it back {when(item.response.at, timeZone)} ({item.response.byName}): {item.response.reason}</p> : null}
          {item.outcome ? (
            <div className="text-[0.8125rem]">
              <p><span className="font-[600]">{item.outcome.state === "DONE" ? "Done" : "Could not be done"}</span> {when(item.outcome.at, timeZone)} ({item.outcome.byName}){item.outcome.note ? `: ${item.outcome.note}` : ""}</p>
              {item.outcome.photos.length > 0 ? <MediaGallery items={item.outcome.photos.map((photo) => ({ id: photo.key, url: photo.url }))} title="Your photos" className="mt-1.5 grid grid-cols-4 gap-2 sm:grid-cols-6" /> : null}
            </div>
          ) : null}
          {item.state === "TAKEN_BACK" ? <p className="text-[0.8125rem]">Our team took this back {when(item.takenBackAt, timeZone)} and is arranging it.</p> : null}

          {item.canAct ? (
            <>
              {item.state === "HANDED_OVER" ? (
                <div className="flex flex-wrap gap-2">
                  <EButton size="sm" disabled={busy} onClick={() => void send({ action: "ACCEPT" }, "Thanks, it's yours to arrange")}>{busy ? "Saving…" : "Accept, I'll arrange it"}</EButton>
                  <EButton size="sm" variant="outline" disabled={busy} onClick={() => { setError(null); setDialog("decline"); }}>Hand it back…</EButton>
                </div>
              ) : null}
              <Disclosure label={person ? "Change your tradesperson or date" : "Add your tradesperson and date"} open={personOpen} onToggle={() => setPersonOpen((value) => !value)}>
                <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
                  <TextField label="Name" value={draft.name} onChange={(value) => set("name", value)} required maxLength={120} autoComplete="off" />
                  <TextField label="Phone" type="tel" value={draft.phone} onChange={(value) => set("phone", value)} maxLength={40} autoComplete="off" />
                  <TextField label="Trade" value={draft.trade} onChange={(value) => set("trade", value)} maxLength={120} />
                  <TextField label="Company" value={draft.company} onChange={(value) => set("company", value)} maxLength={120} />
                  <TextField label="Planned date" type="date" value={draft.plannedDate} onChange={(value) => set("plannedDate", value)} />
                  <div className="grid grid-cols-2 gap-2">
                    <TextField label="From" type="time" value={draft.startTime} onChange={(value) => set("startTime", value)} />
                    <TextField label="Until (optional)" type="time" value={draft.endTime} onChange={(value) => set("endTime", value)} />
                  </div>
                  <label className="flex min-w-0 flex-col gap-1 sm:col-span-2">
                    <span className={LABEL}>How they get in</span>
                    <select value={draft.accessMethod} onChange={(event) => set("accessMethod", event.target.value)} className={cn(FIELD, "h-11")}>
                      {TRADESPERSON_ACCESS_METHODS.map((method) => <option key={method} value={method}>{TRADESPERSON_ACCESS_LABELS[method]}</option>)}
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1 sm:col-span-2">
                    <span className={LABEL}>Note for our team (optional)</span>
                    <textarea rows={2} maxLength={1000} value={draft.note} onChange={(event) => set("note", event.target.value)} className={cn(FIELD, "py-2")} />
                  </label>
                </fieldset>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Times are {timeZone} time. We never contact your tradesperson or give them access codes; with a date, our cleaner that day is told someone is coming.</p>
                <div className="flex flex-wrap gap-2">
                  <EButton size="sm" disabled={busy} onClick={() => void send({ action: "SET_TRADESPERSON", tradesperson: draft }, "Tradesperson saved", () => setPersonOpen(false))}>{busy ? "Saving…" : "Save"}</EButton>
                  {person ? <EButton size="sm" variant="outline" disabled={busy} onClick={() => { setError(null); setDialog("clear"); }}>Clear tradesperson…</EButton> : null}
                </div>
              </Disclosure>
              {item.state === "ACCEPTED" ? (
                <Disclosure label="Record what happened" open={doneOpen} onToggle={() => setDoneOpen((value) => !value)}>
                  <fieldset disabled={busy} className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1">
                      <span className={LABEL}>What was done (required to mark it done)</span>
                      <textarea rows={3} maxLength={2000} value={doneNote} onChange={(event) => setDoneNote(event.target.value)} className={cn(FIELD, "py-2")} />
                    </label>
                    <div className="space-y-1.5">
                      <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] focus-within:ring-2 focus-within:ring-[hsl(var(--e-ring))]">
                        <input type="file" accept="image/*" multiple className="sr-only" disabled={uploads.uploading || busy} onChange={(event) => { void uploads.upload(event.target.files); event.currentTarget.value = ""; }} />
                        <Upload aria-hidden className="mr-2 h-4 w-4" />
                        {uploads.uploading ? "Uploading…" : "Add photos (optional)"}
                      </label>
                      {uploads.error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{uploads.error}</p> : null}
                      {uploads.photos.length > 0 ? (
                        <ul className="flex flex-wrap gap-2">
                          {uploads.photos.map((photo) => (
                            <li key={photo.key} className="relative h-16 w-16 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={photo.url} alt="" className="h-full w-full object-cover" />
                              <button type="button" aria-label="Remove photo" onClick={() => uploads.remove(photo.key)} className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center bg-[hsl(160_18%_8%/0.75)] text-white">
                                <X aria-hidden className="h-3 w-3" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </fieldset>
                  <div className="flex flex-wrap gap-2">
                    <EButton size="sm" disabled={busy || uploads.uploading || !doneNote.trim()} onClick={() => { setError(null); setDialog("done"); }}>Mark done…</EButton>
                    <EButton size="sm" variant="outline" disabled={busy} onClick={() => { setError(null); setDialog("notDone"); }}>It could not be done…</EButton>
                  </div>
                </Disclosure>
              ) : null}
            </>
          ) : null}
          {error && !dialog ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          {finished ? null : <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">You pay your own tradesperson directly. Nothing is added to your invoice for this.</p>}
        </section>
      </ECardBody>

      <EConfirmDialog
        open={dialog === "decline"}
        onClose={() => setDialog(null)}
        tier="destructive"
        title="Hand it back to our team?"
        description="Our team will arrange it instead. Tell us why."
        reason={{ label: "Why", choices: REASON_CHOICES.maintenanceClientDecline }}
        confirmLabel="Hand it back"
        busy={busy}
        error={dialog === "decline" ? error : null}
        onConfirm={(result) => send({ action: "DECLINE", reason: result.reason ?? "" }, "Handed back to our team")}
      />
      <EConfirmDialog
        open={dialog === "clear"}
        onClose={() => setDialog(null)}
        tier="ordinary"
        title="Clear your tradesperson?"
        description="Their details and the planned date are removed from this item, and our cleaner is no longer told someone is coming."
        confirmLabel="Clear"
        busy={busy}
        error={dialog === "clear" ? error : null}
        onConfirm={() => send({ action: "CLEAR_TRADESPERSON" }, "Tradesperson cleared", () => setDraft(draftFrom({ ...item, tradesperson: null }, timeZone)))}
      />
      <EConfirmDialog
        open={dialog === "done"}
        onClose={() => setDialog(null)}
        tier="ordinary"
        title="Mark this repair done?"
        description={`Our team sees your note${uploads.photos.length ? ` and ${uploads.photos.length} photo${uploads.photos.length === 1 ? "" : "s"}` : ""}, and the item is closed.`}
        confirmLabel="Mark done"
        busy={busy}
        error={dialog === "done" ? error : null}
        onConfirm={() => send({ action: "MARK_DONE", note: doneNote, photoKeys: uploads.photos.map((photo) => photo.key) }, "Marked done", () => { setDoneNote(""); uploads.reset(); setDoneOpen(false); })}
      />
      <EConfirmDialog
        open={dialog === "notDone"}
        onClose={() => setDialog(null)}
        tier="destructive"
        title="It could not be done?"
        description="The item goes back to our team to arrange."
        reason={{ label: "What happened", choices: REASON_CHOICES.maintenanceClientNotDone }}
        confirmLabel="Send back to our team"
        busy={busy}
        error={dialog === "notDone" ? error : null}
        onConfirm={(result) => send({ action: "COULD_NOT_DO", reason: result.reason ?? "" }, "Sent back to our team")}
      />
    </ECard>
  );
}

export function ClientHandledItems({ timeZone }: { timeZone: string }) {
  const [state, setState] = React.useState<ListState>({ items: null, error: null, loading: true });
  const [revision, setRevision] = React.useState(0);
  const [showFinished, setShowFinished] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true }));
    fetch("/api/client/maintenance/handled", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { items?: ClientHandledItemView[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body?.items)) {
          setState((current) => ({ ...current, loading: false, error: body?.error ?? "Could not load the items for you to arrange." }));
          return;
        }
        setState({ items: body!.items!, error: null, loading: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, error: "Could not load the items for you to arrange." }));
      });
    return () => controller.abort();
  }, [revision]);

  const replace = (saved: ClientHandledItemView) =>
    setState((current) => ({ ...current, items: (current.items ?? []).map((item) => (item.id === saved.id ? saved : item)) }));

  const active = (state.items ?? []).filter((item) => item.canAct);
  const finished = (state.items ?? []).filter((item) => !item.canAct);
  if (!state.loading && !state.error && state.items && state.items.length === 0) return null;

  return (
    <section aria-labelledby="client-handled-title" className="space-y-3">
      <div>
        <h2 id="client-handled-title" className="text-[1.0625rem] font-[650]">For you to arrange</h2>
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Repairs our team asked you to arrange with your own tradesperson.</p>
      </div>
      {state.loading && !state.items ? <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p> : null}
      {state.error ? (
        <div role="alert" className="space-y-2 text-[0.875rem]">
          <p>{state.error}</p>
          <EButton size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Try again</EButton>
        </div>
      ) : null}
      {state.items && active.length === 0 ? <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Nothing waiting for you right now.</p> : null}
      {active.map((item) => <HandledItemCard key={item.id} initial={item} timeZone={timeZone} onSaved={replace} />)}
      {finished.length > 0 ? (
        <div>
          <button type="button" aria-expanded={showFinished} onClick={() => setShowFinished((value) => !value)} className="flex min-h-11 items-center gap-2 text-[0.875rem] font-[600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
            Earlier ({finished.length})
            <ChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", showFinished && "rotate-180")} />
          </button>
          {showFinished ? <div className="space-y-3 pt-1">{finished.map((item) => <HandledItemCard key={item.id} initial={item} timeZone={timeZone} onSaved={replace} />)}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
