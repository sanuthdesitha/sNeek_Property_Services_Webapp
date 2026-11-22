"use client";

/**
 * Personal notification switches — the same screen for the person and for an
 * administrator looking at that person (lib/notifications/personal). Two-way:
 * both sides read and write the same stores; each switch shows who last
 * changed it and when (organisation timezone).
 *
 * Saves each change at once. While a save runs every switch is frozen; a
 * failed save keeps the change offered for "Try again"; a save refused
 * because someone else changed the switches shows the current switches and
 * offers to apply the change again. A response for a different person never
 * lands here (requests are cancelled and checked when the subject changes).
 */
import * as React from "react";
import { ECard, ECardBody, EButton } from "@/components/v2/ui/primitives";
import { ESelect } from "@/components/v2/admin/estate-kit";
import { LazyDisclosure } from "@/components/v2/admin/notifications/lazy-disclosure";
import { cn } from "@/lib/utils";
import type { PersonalSwitchesView, SwitchCell, SwitchChangeRequest, TypeRowView } from "@/lib/notifications/personal/view-types";

/** Dispatched on window by other controls that change the signed-in person's switches. */
export const PERSONAL_SWITCHES_CHANGED_EVENT = "personal-switches:changed";

export type SwitchesSource = { kind: "self" } | { kind: "admin"; userId: string } | { kind: "admin-client"; clientId: string };

type LoadState = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; view: PersonalSwitchesView; forKey: string };

type SaveProblem = { message: string; changes: SwitchChangeRequest[]; stale: boolean } | null;

function endpointFor(source: SwitchesSource): string {
  if (source.kind === "self") return "/api/me/notification-switches";
  if (source.kind === "admin") return `/api/admin/notifications/switches?userId=${encodeURIComponent(source.userId)}`;
  return `/api/admin/notifications/switches?clientId=${encodeURIComponent(source.clientId)}`;
}

function sourceKey(source: SwitchesSource): string {
  return source.kind === "self" ? "self" : source.kind === "admin" ? `user:${source.userId}` : `client:${source.clientId}`;
}

function formatStamp(cell: SwitchCell, timeZone: string): string | null {
  if (!cell.changed) return null;
  const when = new Intl.DateTimeFormat("en-AU", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(cell.changed.at));
  return `Changed by ${cell.changed.byName ?? "someone"}, ${when}`;
}

function SwitchButton({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--e-radius)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-[var(--e-radius-pill)] border transition-colors duration-[160ms]", checked ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))]")}>
        <span className={cn("absolute h-3.5 w-3.5 rounded-full transition-[left] duration-[160ms]", checked ? "left-[18px] bg-[hsl(var(--e-primary-foreground))]" : "left-[3px] bg-[hsl(var(--e-muted-foreground))]")} />
      </span>
    </button>
  );
}

/** The plain-words notes under a switch: office off, cannot reach, covered by a broader switch, who changed it. */
function CellNotes({ cell, timeZone }: { cell: SwitchCell; timeZone: string }) {
  const stamp = formatStamp(cell, timeZone);
  const notes = [cell.officeOff, cell.unavailable, cell.on ? cell.coveredBy : null, stamp].filter((note): note is string => Boolean(note));
  if (notes.length === 0) return null;
  return (
    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
      {notes.map((note) => <span key={note} className="block">{note}</span>)}
    </span>
  );
}

function SwitchRow({ cell, label, description, timeZone, frozen, onChange }: { cell: SwitchCell; label: string; description?: string; timeZone: string; frozen: boolean; onChange: (cell: SwitchCell, on: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[0.875rem]">{label}</p>
        {description ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{description}</p> : null}
        <CellNotes cell={cell} timeZone={timeZone} />
      </div>
      <SwitchButton checked={cell.on} disabled={frozen || !cell.editable} label={label} onChange={(on) => onChange(cell, on)} />
    </div>
  );
}

function TypeRow({ row, timeZone, frozen, onChange }: { row: TypeRowView; timeZone: string; frozen: boolean; onChange: (cell: SwitchCell, on: boolean) => void }) {
  return (
    <li className="min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <p className="text-[0.875rem] font-[550] [overflow-wrap:anywhere]">{row.name}</p>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{row.trigger}</p>
      {row.fixedText ? <p className="mt-1 text-[0.75rem] font-medium">{row.fixedText}</p> : null}
      {row.officeNote ? <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.officeNote}</p> : null}
      {row.fixed ? null : (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {row.cells.map((cell) => (
            <div key={cell.id} className="flex min-w-0 items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-2.5 py-1">
              <div className="min-w-0">
                <span className="text-[0.8125rem]">{cell.label}</span>
                <CellNotes cell={cell} timeZone={timeZone} />
              </div>
              <SwitchButton checked={cell.on} disabled={frozen || !cell.editable} label={`${row.name}: ${cell.label}`} onChange={(on) => onChange(cell, on)} />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/** Client job updates' email/text cells mirror the channel choice above (text off by default), so only "In the app" counts. */
function rowIsOff(row: TypeRowView): boolean {
  if (row.fixed) return false;
  const cells = row.key === "client.job_updates" ? row.cells.filter((cell) => cell.transport === "APP") : row.cells;
  return cells.some((cell) => !cell.on);
}

/** Client job updates: the long-standing "how we reach you" choice, as its two cells. */
function channelValue(view: PersonalSwitchesView): "EMAIL" | "SMS" | "BOTH" | "NONE" {
  const row = view.groups.flatMap((group) => group.rows).find((item) => item.key === "client.job_updates");
  const email = row?.cells.find((cell) => cell.transport === "EMAIL")?.on ?? true;
  const sms = row?.cells.find((cell) => cell.transport === "SMS")?.on ?? false;
  if (email && sms) return "BOTH";
  if (sms) return "SMS";
  if (email) return "EMAIL";
  return "NONE";
}

function channelChanges(value: "EMAIL" | "SMS" | "BOTH"): SwitchChangeRequest[] {
  const email = { id: "type:client.job_updates:EMAIL", on: value !== "SMS" };
  const sms = { id: "type:client.job_updates:SMS", on: value !== "EMAIL" };
  // Switching on first keeps the stored channel a single value.
  return [email, sms].sort((a, b) => Number(b.on) - Number(a.on));
}

export function PersonalSwitchesPanel({
  source,
  title = "Notifications",
  intro,
  framed = true,
  showTopics = true,
}: {
  source: SwitchesSource;
  title?: string;
  intro?: string;
  /** False when a surrounding card already supplies the section heading. */
  framed?: boolean;
  /** False where the page already shows the older per-topic switches. */
  showTopics?: boolean;
}) {
  const key = sourceKey(source);
  const endpoint = endpointFor(source);
  const [load, setLoad] = React.useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [problem, setProblem] = React.useState<SaveProblem>(null);
  const [saved, setSaved] = React.useState(false);
  const [onlyOff, setOnlyOff] = React.useState(false);
  const currentKey = React.useRef(key);
  const headingId = React.useId();

  // A different person or account: nothing from the previous one carries over.
  React.useEffect(() => {
    currentKey.current = key;
    setProblem(null);
    setSaved(false);
    setOnlyOff(false);
  }, [key]);

  // Another control on the same page changed this person's switches (the
  // topic table on Your profile): reload so the next save is not refused as stale.
  React.useEffect(() => {
    const reload = () => setAttempt((value) => value + 1);
    window.addEventListener(PERSONAL_SWITCHES_CHANGED_EVENT, reload);
    return () => window.removeEventListener(PERSONAL_SWITCHES_CHANGED_EVENT, reload);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    // A reload for the same person keeps the switches on screen; another person never sees them.
    setLoad((current) => (current.kind === "ready" && current.forKey === key ? current : { kind: "loading" }));
    void (async () => {
      try {
        const res = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !body?.subject) {
          setLoad({ kind: "failed", message: typeof body?.error === "string" ? body.error : "The notification switches could not be loaded." });
          return;
        }
        setLoad({ kind: "ready", view: body as PersonalSwitchesView, forKey: key });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: "failed", message: "The notification switches could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [endpoint, key, attempt]);

  async function save(changes: SwitchChangeRequest[]) {
    if (load.kind !== "ready" || load.forKey !== key || saving) return;
    const requestKey = key;
    setSaving(true);
    setProblem(null);
    setSaved(false);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: load.view.revision, changes }),
      });
      const body = await res.json().catch(() => null);
      if (currentKey.current !== requestKey) return;
      if (res.status === 409 && body?.current?.subject) {
        setLoad({ kind: "ready", view: body.current as PersonalSwitchesView, forKey: requestKey });
        setProblem({ message: typeof body.error === "string" ? body.error : "Someone else changed these switches.", changes, stale: true });
        return;
      }
      if (!res.ok || !body?.subject) {
        setProblem({ message: `Not saved: ${typeof body?.error === "string" ? body.error : "try again."}`, changes, stale: false });
        return;
      }
      setLoad({ kind: "ready", view: body as PersonalSwitchesView, forKey: requestKey });
      setSaved(true);
    } catch {
      if (currentKey.current === requestKey) setProblem({ message: "Not saved: the connection failed.", changes, stale: false });
    } finally {
      if (currentKey.current === requestKey) setSaving(false);
    }
  }

  const onChange = (cell: SwitchCell, on: boolean) => void save([{ id: cell.id, on }]);

  const body = (() => {
    if (load.kind === "loading" || (load.kind === "ready" && load.forKey !== key)) return <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading the switches…</p>;
    if (load.kind === "failed") {
      return (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[0.875rem]">
          {load.message} Nothing is shown rather than a guess.
          <EButton variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Try again</EButton>
        </div>
      );
    }
    const view = load.view;
    const frozen = saving || !view.canEdit;
    const groups = view.groups
      .map((group) => ({ ...group, rows: onlyOff ? group.rows.filter(rowIsOff) : group.rows }))
      .filter((group) => group.rows.length > 0);
    const topics = (view.topics ?? []).filter((topic) => !onlyOff || topic.cells.some((cell) => !cell.on && cell.transport !== "SMS"));
    const channel = view.jobEvents ? channelValue(view) : null;
    return (
      <div className="flex min-w-0 flex-col gap-3">
        {view.readOnlyReason ? <p role="note" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{view.readOnlyReason}</p> : null}
        {!view.master.on ? (
          <p role="note" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 py-2 text-[0.8125rem]">
            {view.subject.kind === "CLIENT"
              ? "All notifications are off for this account: nothing automatic is sent to its logins, email address or phone."
              : "All notifications are off: nothing automatic is sent."}
          </p>
        ) : null}
        {view.account ? (
          <p role="note" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {view.account.allOff
              ? `The client account ${view.account.name ?? ""} has all notifications off, so nothing automatic reaches this login either.`
              : `The client account's switches${view.account.offCount ? ` (${view.account.offCount} off)` : ""} also apply to this login.`}
          </p>
        ) : null}

        <SwitchRow cell={view.master} label={view.subject.kind === "CLIENT" ? "Enable notifications" : "All notifications"} description="Turn all automatic notifications on or off." timeZone={view.timeZone} frozen={frozen} onChange={onChange} />

        {view.jobEvents ? (
          <div className="flex flex-col gap-2">
            {view.jobEvents.map((cell) => (
              <SwitchRow key={cell.id} cell={cell} label={cell.label} timeZone={view.timeZone} frozen={frozen || !view.master.on} onChange={onChange} />
            ))}
            <label className="flex flex-col gap-1.5 text-[0.8125rem]">
              <span className="font-medium">{source.kind === "self" ? "How cleaning updates reach you" : "How cleaning updates are sent"}</span>
              <ESelect
                value={channel === "NONE" ? "" : channel ?? "EMAIL"}
                disabled={frozen || !view.master.on}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "EMAIL" || value === "SMS" || value === "BOTH") void save(channelChanges(value));
                }}
              >
                {channel === "NONE" ? <option value="">Neither (switched off below)</option> : null}
                <option value="EMAIL">Email</option>
                <option value="SMS">Text</option>
                <option value="BOTH">Email and text</option>
              </ESelect>
            </label>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-muted-foreground))]">By how it reaches {source.kind === "self" ? "you" : view.subject.kind === "CLIENT" ? "this client" : "this person"}</p>
          {view.transports.map((cell) => (
            <SwitchRow key={cell.id} cell={cell} label={cell.label} timeZone={view.timeZone} frozen={frozen} onChange={onChange} />
          ))}
        </div>

        <label className="flex min-h-11 items-center gap-2 text-[0.8125rem]">
          <input type="checkbox" checked={onlyOff} onChange={(event) => setOnlyOff(event.target.checked)} className="h-4 w-4" />
          Only what is switched off
          <span className="text-[hsl(var(--e-muted-foreground))]">({view.offCount} off)</span>
        </label>

        <LazyDisclosure summary={`Choose each notification${onlyOff ? " (switched off only)" : ""}`}>
          {groups.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{onlyOff ? "Nothing is switched off here." : "No notifications reach this account."}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label} className="flex flex-col gap-2">
                  <h3 className="text-[0.875rem] font-semibold">{group.label}</h3>
                  <ul className="flex flex-col gap-2">
                    {group.rows.map((row) => <TypeRow key={row.key} row={row} timeZone={view.timeZone} frozen={frozen} onChange={onChange} />)}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </LazyDisclosure>

        {showTopics && view.topics ? (
          <LazyDisclosure summary="Topics (older switches, still applied)">
            <p className="mb-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">A topic switched off stops every notification on that topic, whatever the switch on the notification says. Text is off by default.</p>
            {topics.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nothing is switched off here.</p> : (
              <ul className="flex flex-col gap-2">
                {topics.map((topic) => (
                  <li key={topic.category} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                    <p className="text-[0.875rem] font-[550]">{topic.label}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{topic.description}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {topic.cells.map((cell) => (
                        <div key={cell.id} className="flex min-w-0 items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-2.5 py-1">
                          <div className="min-w-0"><span className="text-[0.8125rem]">{cell.label}</span><CellNotes cell={cell} timeZone={view.timeZone} /></div>
                          <SwitchButton checked={cell.on} disabled={frozen || !cell.editable} label={`${topic.label}: ${cell.label}`} onChange={(on) => onChange(cell, on)} />
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </LazyDisclosure>
        ) : null}

        {source.kind === "admin-client" && view.logins && view.logins.length > 0 ? (
          <div className="flex flex-col gap-1 text-[0.8125rem]">
            <p className="font-medium">Logins of this client</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">These switches apply to every login. A login can also switch things off for itself.</p>
            <ul className="flex flex-col gap-1">
              {view.logins.map((login) => (
                <li key={login.id} className="flex flex-wrap items-center justify-between gap-2">
                  <a className="underline [overflow-wrap:anywhere]" href={`/v2/admin/accounts/users/${encodeURIComponent(login.id)}?tab=notifications`}>{login.name ?? login.email ?? "Login"}</a>
                  <span className="text-[hsl(var(--e-muted-foreground))]">{login.offCount ? `${login.offCount} switched off for this login` : "Nothing switched off"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Always sent, whatever these switches say: sign-in codes, password resets, two-step verification and account invitations. A message someone in the office writes and sends by hand still goes.
        </p>

        <div aria-live="polite" className="min-h-5 text-[0.8125rem]">
          {saving ? <span className="text-[hsl(var(--e-muted-foreground))]">Saving…</span> : null}
          {saved && !saving && !problem ? <span className="text-[hsl(var(--e-success))]">Saved.</span> : null}
        </div>
        {problem ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
            <span>{problem.message}</span>
            {view.canEdit ? (
              <EButton variant="outline" size="sm" disabled={saving} onClick={() => void save(problem.changes)}>
                {problem.stale ? "Apply my change again" : "Try again"}
              </EButton>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  })();

  if (!framed) return <div aria-busy={saving || load.kind === "loading"}>{intro ? <p className="mb-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{intro}</p> : null}{body}</div>;
  return (
    <section aria-labelledby={headingId} aria-busy={saving || load.kind === "loading"} className="min-w-0">
      <ECard>
        <ECardBody className="flex flex-col gap-3 p-4 sm:p-6">
          <div>
            <h2 id={headingId} className="e-display-sm">{title}</h2>
            {intro ? <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{intro}</p> : null}
          </div>
          {body}
        </ECardBody>
      </ECard>
    </section>
  );
}
