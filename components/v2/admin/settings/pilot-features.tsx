"use client";

/**
 * Settings › System › Pilot features (2026-11-28). One card per pilot: what
 * it does, who sees a difference, what switching it off does, its state and
 * scope, who changed it last. Administrators change it; operations managers
 * view. Reads GET /api/admin/pilot-features (obsolete reads aborted); saves
 * PATCH the same route and show the stored result.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Loader2, RotateCcw } from "lucide-react";
import { EAlert, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { PILOT_MODE_LABELS, PILOT_MODES, type PilotKey, type PilotMode } from "@/lib/pilots/registry";

type Named = { id: string; name: string };

type PilotView = {
  key: PilotKey;
  name: string;
  description: string;
  affects: string;
  whenOff: string;
  built: boolean;
  unreadable: boolean;
  mode: PilotMode;
  users: Named[];
  properties: Named[];
  changedAt: string | null;
  changedBy: string | null;
};

type PilotPayload = { readable: boolean; canEdit: boolean; pilots: PilotView[] };

type LoadState = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; data: PilotPayload };

type Draft = { mode: PilotMode; userIds: string[]; propertyIds: string[] };

const FILTER_CLASS =
  "h-10 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

function stateLabel(pilot: PilotView): { text: string; tone: "ok" | "neutral" | "warn" } {
  if (pilot.unreadable) return { text: "Could not read — counts as Off", tone: "warn" };
  if (pilot.mode === "ON") return { text: "On for everyone", tone: "ok" };
  if (pilot.mode === "SCOPED") return { text: `On for ${pilot.users.length} ${pilot.users.length === 1 ? "person" : "people"}, ${pilot.properties.length} ${pilot.properties.length === 1 ? "property" : "properties"}`, tone: "ok" };
  return { text: "Off", tone: "neutral" };
}

function PickList({ legend, options, selected, disabled, onChange }: { legend: string; options: Named[]; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const [filter, setFilter] = React.useState("");
  const id = React.useId();
  const shown = options.filter((option) => option.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const chosen = new Set(selected);
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <legend className="text-[0.75rem] font-[550]">{legend} ({selected.length} chosen)</legend>
      <label htmlFor={`${id}-filter`} className="sr-only">Filter {legend.toLowerCase()}</label>
      <input id={`${id}-filter`} className={FILTER_CLASS} placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <div className="max-h-44 overflow-y-auto rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] p-2">
        {shown.length === 0 ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Nothing matches.</p> : null}
        {shown.map((option) => (
          <label key={option.id} className="flex min-h-9 items-center gap-2 text-[0.8125rem]">
            <input
              type="checkbox"
              className="accent-[hsl(var(--e-primary))]"
              checked={chosen.has(option.id)}
              onChange={(event) => onChange(event.target.checked ? [...selected, option.id] : selected.filter((value) => value !== option.id))}
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">{option.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PilotCard({
  pilot,
  canEdit,
  timezone,
  people,
  properties,
  onSaved,
}: {
  pilot: PilotView;
  canEdit: boolean;
  timezone: string;
  people: Named[];
  properties: Named[];
  onSaved: (data: PilotPayload) => void;
}) {
  const initial: Draft = { mode: pilot.mode, userIds: pilot.users.map((user) => user.id), propertyIds: pilot.properties.map((property) => property.id) };
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOff, setConfirmOff] = React.useState(false);
  const label = stateLabel(pilot);
  const ids = React.useId();
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  // Names of chosen people/properties that are no longer listed (deactivated) stay choosable.
  const peopleOptions = [...people, ...pilot.users.filter((user) => !people.some((person) => person.id === user.id))];
  const propertyOptions = [...properties, ...pilot.properties.filter((item) => !properties.some((property) => property.id === item.id))];

  async function save(next: Draft) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pilot-features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: pilot.key, ...next }),
      });
      const body = (await res.json().catch(() => null)) as (PilotPayload & { error?: string }) | null;
      if (!res.ok || !body?.pilots) {
        setError(body?.error ?? "Not saved. The pilot is unchanged.");
        return;
      }
      onSaved(body);
    } catch {
      setError("No connection. Not saved; the pilot is unchanged.");
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="min-w-0 text-[1rem] font-[650]">{pilot.name}</h2>
          <EPill tone={label.tone}>{label.text}</EPill>
        </div>
        <p className="text-[0.8125rem]">{pilot.description}</p>
        <dl className="grid gap-1 text-[0.8125rem] sm:grid-cols-[150px_minmax(0,1fr)]">
          <dt className="text-[hsl(var(--e-muted-foreground))]">Who sees a difference</dt>
          <dd>{pilot.affects}</dd>
          <dt className="text-[hsl(var(--e-muted-foreground))]">Turning it off</dt>
          <dd>{pilot.whenOff}</dd>
          <dt className="text-[hsl(var(--e-muted-foreground))]">Last changed</dt>
          <dd>{pilot.changedAt ? `${formatInTimeZone(new Date(pilot.changedAt), timezone, "d MMM yyyy HH:mm")} by ${pilot.changedBy ?? "someone"}` : "Never — off since it was added"}</dd>
        </dl>
        {!pilot.built ? <EAlert tone="info">Not built yet. Switching it on changes nothing until it is.</EAlert> : null}
        {canEdit ? (
          <div className="space-y-3">
            <fieldset disabled={busy} className="space-y-1">
              <legend className="text-[0.75rem] font-[550]">State</legend>
              {PILOT_MODES.map((mode) => (
                <label key={mode} className="flex min-h-9 items-center gap-2 text-[0.8125rem]">
                  <input type="radio" name={`${ids}-mode`} className="accent-[hsl(var(--e-primary))]" checked={draft.mode === mode} onChange={() => setDraft((previous) => ({ ...previous, mode }))} />
                  {PILOT_MODE_LABELS[mode]}
                </label>
              ))}
            </fieldset>
            {draft.mode === "SCOPED" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <PickList legend="People" options={peopleOptions} selected={draft.userIds} disabled={busy} onChange={(userIds) => setDraft((previous) => ({ ...previous, userIds }))} />
                <PickList legend="Properties" options={propertyOptions} selected={draft.propertyIds} disabled={busy} onChange={(propertyIds) => setDraft((previous) => ({ ...previous, propertyIds }))} />
              </div>
            ) : null}
            {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <EButton size="sm" variant="gold" disabled={busy || !changed} onClick={() => void save(draft)}>
                {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null} Save
              </EButton>
              {pilot.mode !== "OFF" ? (
                <EButton
                  size="sm"
                  variant={confirmOff ? "danger" : "outline"}
                  disabled={busy}
                  onClick={() => {
                    if (!confirmOff) return setConfirmOff(true);
                    const off: Draft = { mode: "OFF", userIds: [], propertyIds: [] };
                    setDraft(off);
                    void save(off);
                  }}
                >
                  <RotateCcw aria-hidden className="h-4 w-4" /> {confirmOff ? "Confirm: turn off now" : "Turn off — back to the previous behaviour"}
                </EButton>
              ) : null}
            </div>
          </div>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

export function PilotFeatures({ timezone, people, properties }: { timezone: string; people: Named[]; properties: Named[] }) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const controllerRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/admin/pilot-features", { cache: "no-store", signal: controller.signal });
      const body = (await res.json().catch(() => null)) as (PilotPayload & { error?: string }) | null;
      if (controller.signal.aborted) return;
      if (!res.ok || !body?.pilots) return setState({ status: "failed", message: body?.error ?? "Could not load pilot features." });
      setState({ status: "ready", data: body });
    } catch {
      if (!controller.signal.aborted) setState({ status: "failed", message: "No connection. Pilot features could not be loaded." });
    }
  }, []);

  React.useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  if (state.status === "loading") {
    return <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]"><Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading pilot features…</p>;
  }
  if (state.status === "failed") {
    return (
      <EAlert tone="danger" title="Pilot features could not be loaded">
        <p>{state.message} Every pilot counts as Off until the state can be read.</p>
        <EButton size="sm" variant="outline" className="mt-2" onClick={() => void load()}>Try again</EButton>
      </EAlert>
    );
  }
  const { data } = state;
  return (
    <div className="space-y-4">
      {!data.readable ? <EAlert tone="warning" title="The saved state could not be read">Every pilot counts as Off (the previous behaviour) until an administrator saves it again.</EAlert> : null}
      {!data.canEdit ? <EAlert tone="info">You can view pilot features. Only an administrator can change them.</EAlert> : null}
      {data.pilots.map((pilot) => (
        <PilotCard
          key={`${pilot.key}:${pilot.changedAt ?? ""}`}
          pilot={pilot}
          canEdit={data.canEdit}
          timezone={timezone}
          people={people}
          properties={properties}
          onSaved={(next) => setState({ status: "ready", data: next })}
        />
      ))}
    </div>
  );
}
