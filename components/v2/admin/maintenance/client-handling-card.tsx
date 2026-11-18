"use client";

/**
 * "Client arranges it" on the admin maintenance item page (client-handled
 * maintenance, 2026-11-18). One card in the right rail:
 *
 *  - not with the client: what happened last time (if anything), and a lazy
 *    disclosure "Ask the client to handle it" with a short note and the
 *    transports (portal inbox, email), confirmed with an ordinary dialog;
 *  - with the client: who handed it over and when, the message outcome per
 *    transport, the client's answer, their tradesperson and planned window
 *    (and whether it is on the cleaner's day), reminders with Remind (ordinary
 *    confirm, transports) and Take it back (destructive, reason required);
 *  - done or could not be done: the client's note and photos, who and when.
 *
 * The note draft survives the disclosure folding and failed saves (with its
 * request key, so a retry cannot hand over or remind twice); it resets when
 * the item changes (the page keys this card by item). Fields freeze while
 * saving. Late answers for an earlier read are ignored.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EToneBand, ETonePill } from "@/components/v2/ui/tone-band";
import { MediaGallery } from "@/components/shared/media-gallery";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";
import { CLIENT_HANDLING_LABELS } from "@/lib/maintenance/client-handling-rules";
import { TRADESPERSON_ACCESS_LABELS } from "@/lib/maintenance/client-tradesperson";
import type { AdminClientHandlingView, ClientMessageRecord, ClientMessageTransport } from "@/lib/maintenance/client-handling-types";
import { toast } from "@/hooks/use-toast";
import { dayTime } from "./maintenance-format";

const CARD = "min-w-0 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]";
const TRANSPORT_LABELS: Record<ClientMessageTransport, string> = { INBOX: "Portal inbox", EMAIL: "Email" };

type Preview = { title: string; body: string } | null;
type LoadState = { view: AdminClientHandlingView | null; preview: { handover: Preview; reminder: Preview }; error: string | null; loading: boolean };

function newRequestKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`.slice(0, 80);
}

async function postAction(itemId: string, body: Record<string, unknown>): Promise<{ view?: AdminClientHandlingView; record?: ClientMessageRecord | null; outcome?: string }> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/maintenance/${encodeURIComponent(itemId)}/client-handling`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Could not reach the server. Check the connection and try again.");
  }
  const parsed = (await response.json().catch(() => ({}))) as { error?: string; view?: AdminClientHandlingView; record?: ClientMessageRecord | null; outcome?: string };
  if (!response.ok) throw new Error(parsed.error || "That could not be saved. Nothing was changed.");
  return parsed;
}

function useClientHandling(itemId: string, revision: number): LoadState & { reload: () => void; replace: (view: AdminClientHandlingView) => void } {
  const [state, setState] = React.useState<LoadState>({ view: null, preview: { handover: null, reminder: null }, error: null, loading: true });
  const [own, setOwn] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true }));
    fetch(`/api/admin/maintenance/${encodeURIComponent(itemId)}/client-handling`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { view?: AdminClientHandlingView; preview?: LoadState["preview"]; error?: string } | null;
        // Checked after parsing: a late answer for an earlier read is dropped.
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.view || body.view.itemId !== itemId) {
          setState((current) => ({ ...current, loading: false, error: body?.error ?? "The client handling could not be loaded." }));
          return;
        }
        setState({ view: body.view, preview: body.preview ?? { handover: null, reminder: null }, error: null, loading: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, error: "The client handling could not be loaded." }));
      });
    return () => controller.abort();
  }, [itemId, revision, own]);
  return {
    ...state,
    reload: () => setOwn((value) => value + 1),
    replace: (view) => setState((current) => ({ ...current, view, error: null })),
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 border-t border-[hsl(var(--e-border))] py-1.5 text-[0.8125rem] first:border-t-0 max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const TONE_CLASS: Record<"sent" | "held" | "failed", string> = {
  sent: "text-[hsl(var(--e-success))]",
  held: "text-[hsl(var(--e-warning))]",
  failed: "text-[hsl(var(--e-danger))]",
};

/** Each transport's real outcome. Queued is said as queued, never as delivered. */
export function MessageOutcomes({ record, timeZone }: { record: ClientMessageRecord | null; timeZone: string }) {
  if (!record) return <span className="text-[hsl(var(--e-muted-foreground))]">No message was sent</span>;
  if (record.pending) return <span>Sending… (started {dayTime(record.at, timeZone)})</span>;
  if (record.refusal) return <span className={TONE_CLASS.held}>Not sent: {record.refusal}</span>;
  if (record.outcomes.length === 0) return <span className="text-[hsl(var(--e-muted-foreground))]">Nothing was sent</span>;
  return (
    <ul className="space-y-0.5">
      {record.outcomes.map((outcome, index) => (
        <li key={`${outcome.transport}-${index}`}>
          <span className="font-[550]">{outcome.transport === "INBOX" ? "Portal inbox" : outcome.transport === "EMAIL" ? "Email" : outcome.transport}</span>
          {" · "}
          {outcome.name}
          {": "}
          <span className={TONE_CLASS[outcome.tone]}>{outcome.label}</span>
        </li>
      ))}
    </ul>
  );
}

function TransportChoice({ value, onChange, disabled, idPrefix }: { value: ClientMessageTransport[]; onChange: (next: ClientMessageTransport[]) => void; disabled?: boolean; idPrefix: string }) {
  return (
    <fieldset disabled={disabled} className="flex flex-wrap gap-x-4 gap-y-1">
      <legend className="mb-1 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Tell the client by</legend>
      {(["INBOX", "EMAIL"] as const).map((transport) => (
        <label key={transport} htmlFor={`${idPrefix}-${transport}`} className="flex min-h-8 items-center gap-1.5 text-[0.8125rem] max-sm:min-h-11">
          <input
            id={`${idPrefix}-${transport}`}
            type="checkbox"
            checked={value.includes(transport)}
            onChange={(event) => onChange(event.target.checked ? Array.from(new Set([...value, transport])) : value.filter((item) => item !== transport))}
            className="h-4 w-4 accent-[hsl(var(--e-primary))]"
          />
          {TRANSPORT_LABELS[transport]}
        </label>
      ))}
    </fieldset>
  );
}

function windowText(start: string | null, end: string | null, timeZone: string): string {
  if (!start) return "No date yet";
  const from = dayTime(start, timeZone) ?? "Not recorded";
  if (!end) return `${from} (from)`;
  const until = dayTime(end, timeZone) ?? "";
  return `${from} to ${until.slice(-5)}`;
}

export function ClientHandlingCard({ itemId, timeZone, revision, onChanged }: { itemId: string; timeZone: string; revision: number; onChanged: () => void }) {
  const data = useClientHandling(itemId, revision);
  const [askOpen, setAskOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [handoverTransports, setHandoverTransports] = React.useState<ClientMessageTransport[]>(["INBOX", "EMAIL"]);
  const [reminderTransports, setReminderTransports] = React.useState<ClientMessageTransport[]>(["INBOX", "EMAIL"]);
  const [dialog, setDialog] = React.useState<"handover" | "remind" | "takeBack" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  // One key per draft: a retry after a failure re-sends the same key, so it cannot act twice.
  const handoverKey = React.useRef(newRequestKey("handover"));
  const reminderKey = React.useRef(newRequestKey("remind"));
  const regionId = React.useId();

  const view = data.view;

  async function run(kind: "handover" | "remind" | "takeBack", reason?: string) {
    setBusy(true);
    setError(null);
    try {
      const body =
        kind === "handover"
          ? { action: "HAND_OVER", note: note.trim() || null, transports: handoverTransports, requestKey: handoverKey.current }
          : kind === "remind"
            ? { action: "REMIND", transports: reminderTransports, requestKey: reminderKey.current }
            : { action: "TAKE_BACK", reason: reason ?? "" };
      const result = await postAction(itemId, body);
      if (result.view) data.replace(result.view);
      if (kind === "handover") {
        setNote("");
        setAskOpen(false);
        handoverKey.current = newRequestKey("handover");
        setStatus("Handed to the client. The message outcome is shown below.");
        toast({ title: "Handed to the client" });
      } else if (kind === "remind") {
        reminderKey.current = newRequestKey("remind");
        setStatus(result.outcome === "replayed" ? "That reminder was already sent; its outcome is shown below." : "Reminder recorded. Each transport's outcome is shown below.");
        toast({ title: "Reminder sent", description: "See the outcome per transport on the card." });
      } else {
        setStatus("Taken back. The client's record is kept on the item.");
        toast({ title: "Taken back from the client" });
      }
      setDialog(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That could not be saved. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const withClient = Boolean(view?.withClient);
  const band = withClient ? { tone: "info" as const, pill: "With the client" } : view?.state === "DECLINED" || view?.state === "NOT_DONE" ? { tone: "attention" as const, pill: view.state === "DECLINED" ? "Client declined" : "Client could not do it" } : view?.state === "DONE" ? { tone: "good" as const, pill: "Client did it" } : null;
  const heading = (
    <div className="flex min-w-0 items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 id="m-client-title" className="text-[0.9375rem] font-[650]">Client arranges it</h2>
        <p className="text-[0.75rem] opacity-80">{view ? CLIENT_HANDLING_LABELS[view.state] : data.loading ? "Loading…" : "Not available"}</p>
      </div>
      {band ? <ETonePill tone={band.tone}>{band.pill}</ETonePill> : null}
    </div>
  );

  return (
    <section id="m-client" aria-labelledby="m-client-title" aria-busy={data.loading || busy} className={cn(CARD, "overflow-hidden")}>
      {band ? <EToneBand tone={band.tone} className="px-3.5 py-2.5">{heading}</EToneBand> : <div className="px-3.5 pt-3">{heading}</div>}
      <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3">
        {!view && data.loading ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading the client's side…</p> : null}
        {data.error ? (
          <div role="alert" className="space-y-1.5 text-[0.8125rem]">
            <p>{data.error}</p>
            <EButton size="sm" variant="outline" onClick={data.reload}>Try again</EButton>
          </div>
        ) : null}
        {view ? (
          <>
            {view.handedOver || view.response || view.tradesperson || view.outcome || view.takenBack ? (
              <dl>
                {view.handedOver ? (
                  <Row label="Handed over">
                    {dayTime(view.handedOver.at, timeZone)} by {view.handedOver.byName}
                    {view.handedOver.note ? <span className="block text-[hsl(var(--e-text-secondary))]">“{view.handedOver.note}”</span> : null}
                  </Row>
                ) : null}
                {view.handedOver ? (
                  <Row label="Message">
                    <MessageOutcomes record={view.handoverMessage} timeZone={timeZone} />
                  </Row>
                ) : null}
                <Row label="Client's answer">
                  {view.response ? (
                    view.response.state === "ACCEPTED" ? (
                      <span>Accepted {dayTime(view.response.at, timeZone)} by {view.response.byName}</span>
                    ) : (
                      <span>
                        <b className="text-[hsl(var(--e-warning))]">Declined</b> {dayTime(view.response.at, timeZone)} by {view.response.byName}
                        {view.response.reason ? <span className="block">Reason: {view.response.reason}</span> : null}
                      </span>
                    )
                  ) : withClient ? (
                    <span className="text-[hsl(var(--e-muted-foreground))]">No answer yet</span>
                  ) : (
                    <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>
                  )}
                </Row>
                {view.tradesperson ? (
                  <>
                    <Row label="Their tradesperson">
                      <span className="font-[550]">{view.tradesperson.name}</span>
                      {[view.tradesperson.trade, view.tradesperson.company].filter(Boolean).length ? ` · ${[view.tradesperson.trade, view.tradesperson.company].filter(Boolean).join(", ")}` : ""}
                      {view.tradesperson.phone ? (
                        <span className="block">
                          <a className="text-[hsl(var(--e-primary))] underline" href={`tel:${view.tradesperson.phone.replace(/[^0-9+]/g, "")}`}>{view.tradesperson.phone}</a>
                        </span>
                      ) : null}
                      {view.tradesperson.note ? <span className="block text-[hsl(var(--e-text-secondary))]">“{view.tradesperson.note}”</span> : null}
                      {view.tradesperson.updatedAt ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Recorded {dayTime(view.tradesperson.updatedAt, timeZone)} by {view.tradesperson.updatedByName}</span> : null}
                    </Row>
                    <Row label="Planned">
                      {windowText(view.tradesperson.plannedStart, view.tradesperson.plannedEnd, timeZone)}
                      {view.tradesperson.plannedStart ? (
                        <span className="block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                          {view.tradesperson.accessMethod ? `${TRADESPERSON_ACCESS_LABELS[view.tradesperson.accessMethod]}. ` : ""}
                          {view.tradesperson.onCleanersDay ? "Shown to the cleaner on that day's job." : "Not on a cleaner's job surface."}
                        </span>
                      ) : null}
                    </Row>
                  </>
                ) : withClient ? (
                  <Row label="Their tradesperson"><span className="text-[hsl(var(--e-muted-foreground))]">Not recorded yet</span></Row>
                ) : null}
                {view.outcome ? (
                  <Row label={view.outcome.state === "DONE" ? "Done" : "Could not be done"}>
                    {dayTime(view.outcome.at, timeZone)} by {view.outcome.byName}
                    {view.outcome.note ? <span className="block">{view.outcome.state === "DONE" ? "Note" : "Reason"}: {view.outcome.note}</span> : null}
                    {view.outcome.photos.length > 0 ? (
                      <div className="pt-1.5">
                        <MediaGallery items={view.outcome.photos.map((photo) => ({ id: photo.key, url: photo.url }))} title="Client's photos" className="grid grid-cols-3 gap-2" />
                      </div>
                    ) : view.outcome.state === "DONE" ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No photos added</span> : null}
                  </Row>
                ) : null}
                {view.takenBack ? (
                  <Row label="Taken back">
                    {dayTime(view.takenBack.at, timeZone)} by {view.takenBack.byName}
                    {view.takenBack.reason ? <span className="block">Reason: {view.takenBack.reason}</span> : null}
                  </Row>
                ) : null}
                {view.handedOver ? (
                  <Row label="Reminders">
                    {view.reminders.count === 0 ? "None sent" : `${view.reminders.count} sent`}
                    {view.reminders.last ? (
                      <span className="block">
                        Last {dayTime(view.reminders.last.at, timeZone)} by {view.reminders.last.byName}
                        <span className="block"><MessageOutcomes record={view.reminders.last.message} timeZone={timeZone} /></span>
                      </span>
                    ) : null}
                  </Row>
                ) : null}
              </dl>
            ) : (
              <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Ask the client to arrange this repair with their own tradesperson. They accept or hand it back, and you see their progress here.</p>
            )}

            {withClient ? (
              <div className="flex flex-col gap-2 border-t border-[hsl(var(--e-border))] pt-2.5">
                <TransportChoice value={reminderTransports} onChange={setReminderTransports} disabled={busy} idPrefix={`${regionId}-remind`} />
                {view.reminderBlocker ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{view.reminderBlocker}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <EButton variant="outline" size="sm" disabled={busy || Boolean(view.reminderBlocker) || reminderTransports.length === 0} onClick={() => { setError(null); setDialog("remind"); }}>Remind the client…</EButton>
                  <EButton variant="outline" size="sm" disabled={busy} onClick={() => { setError(null); setDialog("takeBack"); }}>Take it back…</EButton>
                </div>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Reminders are sent only when you press Remind. Their tradesperson is never messaged by us, and gets no access codes from us.</p>
              </div>
            ) : view.state !== "DONE" ? (
              <div className="border-t border-[hsl(var(--e-border))] pt-2">
                <button
                  type="button"
                  aria-expanded={askOpen}
                  aria-controls={regionId}
                  onClick={() => setAskOpen((value) => !value)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-[0.875rem] font-[600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
                >
                  {view.handedOver ? "Ask the client again" : "Ask the client to handle it"}
                  <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 transition-transform", askOpen && "rotate-180")} />
                </button>
                {/* Kept mounted while folded so the note survives. */}
                <div id={regionId} hidden={!askOpen} className={cn("flex-col gap-2 pt-1", askOpen ? "flex" : "hidden")}>
                  {view.handoverBlockers.length > 0 ? (
                    <div className="rounded-[10px] border border-[hsl(var(--e-border))] p-2.5 text-[0.8125rem]">
                      <p className="font-[600]">Not possible yet</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {view.handoverBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  <fieldset disabled={busy} className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Note to the client (optional)</span>
                      <textarea
                        value={note}
                        maxLength={1000}
                        rows={3}
                        onChange={(event) => setNote(event.target.value)}
                        className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.875rem] focus:border-[hsl(var(--e-gold))] focus:outline-none max-sm:text-base"
                      />
                    </label>
                    <TransportChoice value={handoverTransports} onChange={setHandoverTransports} disabled={busy} idPrefix={`${regionId}-handover`} />
                    {handoverTransports.length === 0 ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">No message: the client will only see it in their portal.</p> : null}
                  </fieldset>
                  <div>
                    <EButton size="sm" disabled={busy || view.handoverBlockers.length > 0} onClick={() => { setError(null); setDialog("handover"); }}>Ask the client…</EButton>
                  </div>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No pay for us and no charge to the client. Nothing is invoiced; the client pays their own tradesperson.</p>
                </div>
              </div>
            ) : null}
            {error && !dialog ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
            <p role="status" aria-live="polite" className="sr-only">{status ?? ""}</p>
          </>
        ) : null}
      </div>

      <EConfirmDialog
        open={dialog === "handover"}
        onClose={() => setDialog(null)}
        tier="ordinary"
        title="Ask the client to handle this?"
        description={
          <span className="space-y-1">
            <span className="block">{view?.clientName ?? "The client"} will see it as theirs to arrange. {handoverTransports.length ? `They are told by ${handoverTransports.map((transport) => TRANSPORT_LABELS[transport].toLowerCase()).join(" and ")}.` : "No message is sent."}</span>
            {data.preview.handover && handoverTransports.length ? <span className="block text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">“{data.preview.handover.title}”</span> : null}
          </span>
        }
        confirmLabel="Ask the client"
        busy={busy}
        error={dialog === "handover" ? error : null}
        onConfirm={() => run("handover")}
      />
      <EConfirmDialog
        open={dialog === "remind"}
        onClose={() => setDialog(null)}
        tier="ordinary"
        title="Remind the client?"
        description={`${view?.clientName ?? "The client"} gets a reminder by ${reminderTransports.map((transport) => TRANSPORT_LABELS[transport].toLowerCase()).join(" and ")}. ${view?.reminders.count ? `${view.reminders.count} sent so far.` : "This is the first reminder."}`}
        confirmLabel="Send reminder"
        busy={busy}
        error={dialog === "remind" ? error : null}
        onConfirm={() => run("remind")}
      />
      <EConfirmDialog
        open={dialog === "takeBack"}
        onClose={() => setDialog(null)}
        tier="destructive"
        title="Take it back from the client?"
        description="The office arranges it again. The client's answer, tradesperson and notes are kept on the item; a planned visit is taken off the cleaner's day."
        reason={{ label: "Why", choices: REASON_CHOICES.maintenanceTakeBack }}
        confirmLabel="Take it back"
        busy={busy}
        error={dialog === "takeBack" ? error : null}
        onConfirm={(result) => run("takeBack", result.reason)}
      />
    </section>
  );
}
