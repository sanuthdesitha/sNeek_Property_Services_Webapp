"use client";

/**
 * Settings › System › Tutorials (board "Tutorials settings"): tours by role
 * with version, status and finished / skipped rates; a step editor (words,
 * order, hide, What's new, status; targets chosen from the code registry);
 * release notes with "no visible change" reasons; one person's tours with
 * reset; on/off per role; preview as a role. Administrators edit, operations
 * managers view. Each publish is an ordinary confirmation.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowDown, ArrowUp, Eye } from "lucide-react";
import { EButton, ECard, ETabs } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { TOURS, findTour } from "@/lib/tutorials/registry";
import { TOUR_TARGETS, targetsForPage, type TourTargetId } from "@/lib/tutorials/targets";
import { countWords, personalise, resolveSteps } from "@/lib/tutorials/engine";
import { tourPages } from "@/lib/tutorials/fingerprint";
import { RELEASE_NOTES } from "@/lib/tutorials/releases";
import { TOUR_ROLE_LABELS, TOUR_ROLES, type TourDefinition, type TourProgressRecord, type TourPublishStatus, type TourRole, type TourSettingView } from "@/lib/tutorials/types";
import type { TourStats } from "@/lib/tutorials/store";

export type TutorialsTab = "tours" | "whats-new" | "people" | "switches";

type NoVisibleChangeNote = { tourKey: string; fingerprint: string; reason: string; by: string; date: string };

type Overview = { settings: { roles: Record<TourRole, boolean>; tours: Record<string, TourSettingView> }; stats: TourStats[] };

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Overview };

const GROUPS: Array<{ label: string; roles: TourRole[] }> = [
  { label: "Administrators and operations managers", roles: ["ADMIN", "OPS_MANAGER"] },
  { label: "Cleaners", roles: ["CLEANER"] },
  { label: "Clients and assistants", roles: ["CLIENT", "VA"] },
  { label: "Laundry, QA, maintenance", roles: ["LAUNDRY", "QA_INSPECTOR", "MAINTENANCE"] },
];

const STATUS_TONE: Record<TourPublishStatus, EPillTone> = { LIVE: "ok", DRAFT: "neutral", PAUSED: "warn" };
const STATUS_LABEL: Record<TourPublishStatus, string> = { LIVE: "Live", DRAFT: "Draft", PAUSED: "Paused" };

function kindLabel(tour: TourDefinition): string {
  if (tour.kind === "welcome") return "Welcome";
  if (tour.kind === "walkthrough") return tour.practice ? "Walkthrough · practice" : "Walkthrough";
  return "Page";
}

function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

async function sendJson(url: string, method: "PATCH" | "POST", body: unknown): Promise<{ ok: boolean; data: any }> {
  try {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: { error: "The server could not be reached." } };
  }
}

export function TutorialsWorkspace({ canEdit, timezone, tab, noVisibleChange }: { canEdit: boolean; timezone: string; tab: TutorialsTab; noVisibleChange: NoVisibleChangeNote[] }) {
  const [load, setLoad] = React.useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/admin/tutorials", { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !body) setLoad({ status: "error", message: body?.error ?? "Tutorials could not be loaded." });
        else setLoad({ status: "ready", data: body as Overview });
      } catch {
        if (!controller.signal.aborted) setLoad({ status: "error", message: "Tutorials could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);
  const paused = load.status === "ready" ? Object.values(load.data.settings.tours).filter((entry) => entry.status === "PAUSED").length : 0;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ETabs
          ariaLabel="Tutorials sections"
          active={tab}
          hrefFor={(key) => `/v2/admin/settings/tutorials?tab=${key}`}
          items={[
            { key: "tours", label: `Tours ${TOURS.length}` },
            { key: "whats-new", label: "What's new" },
            { key: "people", label: "People" },
            { key: "switches", label: "Switches" },
          ]}
        />
        {paused > 0 ? <EPill tone="warn">{`${paused} tour${paused === 1 ? "" : "s"} paused`}</EPill> : null}
        <PreviewButton />
      </div>
      {!canEdit ? <p role="note" className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">You can view tutorials. Only administrators change them.</p> : null}

      {load.status === "loading" ? <p role="status" className="text-[0.875rem]">Loading tutorials…</p> : null}
      {load.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-[0.875rem]">
          {load.message}
          <EButton variant="outline" size="sm" onClick={reload}>Retry</EButton>
        </div>
      ) : null}
      {load.status === "ready" ? (
        <>
          {tab === "tours" ? <ToursTab data={load.data} canEdit={canEdit} timezone={timezone} onSaved={reload} /> : null}
          {tab === "whats-new" ? <WhatsNewTab notes={noVisibleChange} /> : null}
          {tab === "people" ? <PeopleTab canEdit={canEdit} timezone={timezone} /> : null}
          {tab === "switches" ? <SwitchesTab roles={load.data.settings.roles} canEdit={canEdit} onSaved={reload} /> : null}
        </>
      ) : null}
    </div>
  );
}

/* ── Tours ─────────────────────────────────────────────────────────────── */

function ToursTab({ data, canEdit, timezone, onSaved }: { data: Overview; canEdit: boolean; timezone: string; onSaved: () => void }) {
  const [selected, setSelected] = React.useState<string>(TOURS.find((tour) => tour.kind === "page")?.key ?? TOURS[0].key);
  const statsByKey = new Map(data.stats.map((entry) => [entry.tourKey, entry]));
  const tour = findTour(selected)!;
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <ECard className="min-w-0 overflow-hidden">
        {GROUPS.map((group) => {
          const tours = TOURS.filter((entry) => entry.roles.some((role) => group.roles.includes(role)) && !GROUPS.slice(0, GROUPS.indexOf(group)).some((earlier) => entry.roles.some((role) => earlier.roles.includes(role))));
          return (
            <section key={group.label} aria-label={group.label}>
              <h2 className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-4 py-2 text-[0.6875rem] font-[650] uppercase tracking-[0.06em] text-[hsl(var(--e-text-secondary))]">{group.label}</h2>
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {tours.map((entry) => {
                  const setting = data.settings.tours[entry.key];
                  const status: TourPublishStatus = setting?.status ?? "LIVE";
                  const stats = statsByKey.get(entry.key);
                  const finished = stats ? percent(stats.finished, stats.opened) : null;
                  const skipped = stats ? percent(stats.skipped, stats.opened) : null;
                  const active = entry.key === selected;
                  return (
                    <li key={entry.key} className={cn("flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5", active && "bg-[hsl(var(--e-primary)/0.08)]")}>
                      <button type="button" onClick={() => setSelected(entry.key)} aria-pressed={active} className="min-h-11 min-w-[12rem] flex-1 text-left">
                        <span className="block truncate text-[0.875rem] font-[600]">{entry.title}</span>
                        <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{`${kindLabel(entry)} · ${entry.steps.length} steps · ${entry.roles.map((role) => TOUR_ROLE_LABELS[role]).join(", ")}`}</span>
                      </button>
                      <span className="w-12 text-[0.8125rem] e-tnum">{`v${entry.version}${setting?.revision ? `.${setting.revision}` : ""}`}</span>
                      <EPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</EPill>
                      {stats && stats.missingReports > 0 ? <EPill tone="bad">{`Missing control for ${stats.missingReports}`}</EPill> : null}
                      <span className="w-32 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                        {finished === null ? "Not opened yet" : `${finished}% finished · ${skipped}% skipped`}
                      </span>
                      <span className="w-20 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{setting?.updatedAt ? formatInTimeZone(setting.updatedAt, timezone, "d MMM") : "As shipped"}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <p className="px-4 py-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Finished = people who reached the last step of the current version, out of people who opened the tour.</p>
      </ECard>
      <TourEditor key={`${tour.key}:${data.settings.tours[tour.key]?.updatedAt ?? ""}`} tour={tour} setting={data.settings.tours[tour.key]} canEdit={canEdit} onSaved={onSaved} />
    </div>
  );
}

type StepDraft = { id: string; title: string; body: string; hidden: boolean; target: TourTargetId | null; whatsNew: boolean };

function TourEditor({ tour, setting, canEdit, onSaved }: { tour: TourDefinition; setting: TourSettingView | undefined; canEdit: boolean; onSaved: () => void }) {
  const initial = React.useMemo<StepDraft[]>(() => {
    const visible = resolveSteps(tour, setting);
    const hidden = tour.steps.filter((step) => !visible.some((entry) => entry.id === step.id));
    return [...visible, ...hidden].map((step) => ({
      id: step.id,
      title: step.title,
      body: step.body,
      hidden: hidden.includes(step),
      target: step.target,
      whatsNew: false,
    }));
  }, [tour, setting]);
  const [drafts, setDrafts] = React.useState<StepDraft[]>(initial);
  const [status, setStatus] = React.useState<TourPublishStatus>(setting?.status ?? "LIVE");
  const [confirming, setConfirming] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const pages = tourPages(tour);
  const registryTargets = pages.flatMap((page) => targetsForPage(page));
  const usedTargets = new Set(drafts.map((step) => step.target).filter(Boolean));
  const changed = JSON.stringify(drafts) !== JSON.stringify(initial) || status !== (setting?.status ?? "LIVE");
  const tooLong = drafts.some((step) => countWords(step.body) > 25);

  const update = (id: string, patch: Partial<StepDraft>) => setDrafts((current) => current.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  const move = (index: number, delta: -1 | 1) => setDrafts((current) => {
    const next = [...current];
    const [step] = next.splice(index, 1);
    next.splice(index + delta, 0, step);
    return next;
  });

  const publish = async () => {
    setSaving(true);
    setError(null);
    const code = new Map(tour.steps.map((step) => [step.id, step]));
    const result = await sendJson(`/api/admin/tutorials/tours/${encodeURIComponent(tour.key)}`, "PATCH", {
      status,
      order: drafts.map((step) => step.id),
      steps: drafts.map((step) => {
        const original = code.get(step.id)!;
        return {
          id: step.id,
          title: step.title !== original.title ? step.title : undefined,
          body: step.body !== original.body ? step.body : undefined,
          hidden: step.hidden || undefined,
          target: step.target && step.target !== original.target ? step.target : undefined,
          whatsNew: step.whatsNew || undefined,
        };
      }),
    });
    setSaving(false);
    if (!result.ok) {
      setError(`It was not saved: ${result.data?.error ?? "the server refused the change."}`);
      return;
    }
    setConfirming(false);
    setSaved("Published. People mid-tour continue on the new version; only steps marked What's new re-show.");
    onSaved();
  };

  return (
    <ECard className="min-w-0 space-y-3 p-4" aria-labelledby="tour-editor-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="tour-editor-title" className="text-[1rem] font-[600]">{`${tour.title} · ${kindLabel(tour).toLowerCase()}`}</h2>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{`v${tour.version}${setting?.revision ? ` · revision ${setting.revision}` : ""} · ${pages.join(", ")}`}</p>
        </div>
        <label className="flex flex-col gap-1 text-[0.75rem] font-[550]">
          Status
          <select value={status} disabled={!canEdit || saving} onChange={(event) => setStatus(event.target.value as TourPublishStatus)} className="h-11 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[16px] sm:h-9 sm:text-[0.8125rem]">
            <option value="LIVE">Live</option>
            <option value="DRAFT">Draft (not shown)</option>
            <option value="PAUSED">Paused for everyone</option>
          </select>
        </label>
      </div>

      <fieldset disabled={!canEdit || saving} className="min-w-0 space-y-2">
        <legend className="sr-only">Steps</legend>
        <ol className="space-y-2">
          {drafts.map((step, index) => {
            const words = countWords(step.body);
            // The step's own target first, then the other registered targets on the same page.
            const samePage = registryTargets.filter((id) => id !== step.target && step.target !== null && TOUR_TARGETS[id].page === TOUR_TARGETS[step.target].page);
            const options = step.target ? [step.target, ...samePage] : samePage;
            return (
              <li key={step.id} className={cn("min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3", step.hidden && "opacity-60")}>
                <div className="flex items-center gap-2">
                  <span className="e-tnum text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{index + 1}</span>
                  <input aria-label={`Step ${index + 1} title`} value={step.title} maxLength={60} onChange={(event) => update(step.id, { title: event.target.value })} className="h-11 min-w-0 flex-1 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[16px] font-[600] sm:h-9 sm:text-[0.875rem]" />
                  <EButton type="button" variant="ghost" size="icon" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" aria-hidden /></EButton>
                  <EButton type="button" variant="ghost" size="icon" aria-label={`Move step ${index + 1} down`} disabled={index === drafts.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" aria-hidden /></EButton>
                </div>
                <label className="mt-2 block text-[0.75rem] font-[550]" htmlFor={`words-${step.id}`}>{`Words · ${words} of 25`}</label>
                <textarea id={`words-${step.id}`} rows={2} value={step.body} aria-invalid={words > 25} onChange={(event) => update(step.id, { body: event.target.value })} className="mt-1 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 py-1.5 text-[16px] sm:text-[0.8125rem]" />
                {words > 25 ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">At most 25 words.</p> : null}
                {step.target ? (
                  <label className="mt-2 flex min-w-0 flex-col gap-1 text-[0.75rem] font-[550]">
                    Points at
                    <select value={step.target} onChange={(event) => update(step.id, { target: event.target.value as TourTargetId })} className="h-11 w-full min-w-0 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 font-mono text-[16px] sm:h-9 sm:text-[0.75rem]">
                      {options.map((id) => <option key={id} value={id}>{`${id} · ${TOUR_TARGETS[id].label}`}</option>)}
                    </select>
                  </label>
                ) : <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">A centred card (no control).</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <label className="flex min-h-11 items-center gap-2 text-[0.8125rem] sm:min-h-8"><input type="checkbox" checked={step.hidden} onChange={(event) => update(step.id, { hidden: event.target.checked })} className="h-4 w-4" /> Hide this step</label>
                  <label className="flex min-h-11 items-center gap-2 text-[0.8125rem] sm:min-h-8"><input type="checkbox" checked={step.whatsNew} onChange={(event) => update(step.id, { whatsNew: event.target.checked })} className="h-4 w-4" /> Show this change as What&apos;s new to people who finished</label>
                </div>
              </li>
            );
          })}
        </ol>
      </fieldset>

      <section aria-labelledby="registry-targets" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-3">
        <h3 id="registry-targets" className="text-[0.8125rem] font-[600]">{`Targets on this page (from the registry) · ${registryTargets.length}`}</h3>
        <ul className="mt-1 space-y-0.5">
          {registryTargets.map((id) => (
            <li key={id} className="flex flex-wrap justify-between gap-2 text-[0.75rem]"><span className="font-mono [overflow-wrap:anywhere]">{`${id} · ${TOUR_TARGETS[id].label}`}</span><span className="text-[hsl(var(--e-muted-foreground))]">{usedTargets.has(id) ? "in use" : "free"}</span></li>
          ))}
        </ul>
        <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Targets are named in code by the page. There is no way to type a selector here.</p>
      </section>

      {saved ? <p role="status" className="text-[0.8125rem]">{saved}</p> : null}
      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2">
          <EButton variant="ghost" disabled={!changed || saving} onClick={() => { setDrafts(initial); setStatus(setting?.status ?? "LIVE"); }}>Discard</EButton>
          <EButton disabled={!changed || tooLong || saving} onClick={() => { setSaved(null); setError(null); setConfirming(true); }}>Publish</EButton>
        </div>
      ) : null}
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Publishing: people mid-tour continue on the new version; people who finished see only steps marked What&apos;s new. Word fixes without the box ticked don&apos;t re-show anything.</p>
      <EConfirmDialog
        open={confirming}
        onClose={() => { if (!saving) setConfirming(false); }}
        tier="ordinary"
        title={`Publish the ${tour.title} tour?`}
        description={drafts.some((step) => step.whatsNew) ? "Steps marked What's new show once to everyone who finished this tour." : "The new words show from the next step anyone sees. Nothing re-shows."}
        confirmLabel="Publish"
        busy={saving}
        error={error}
        onConfirm={publish}
      />
    </ECard>
  );
}

/* ── What's new and release notes ──────────────────────────────────────── */

function WhatsNewTab({ notes }: { notes: NoVisibleChangeNote[] }) {
  return (
    <div className="min-w-0 space-y-4">
      <p className="max-w-3xl text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
        Every change in a release note that touches a page with a tour needs a What&apos;s new step or a &quot;no visible change&quot; reason. The list comes from the release notes and the registry in the code, checked by a test on every build. To re-show a reworded step, edit it on Tours and tick &quot;Show this change as What&apos;s new&quot;.
      </p>
      {RELEASE_NOTES.map((note) => (
        <ECard key={note.release} className="min-w-0 space-y-2 p-4">
          <h2 className="text-[1rem] font-[600]">{`Release ${note.release} · ${note.date}`}</h2>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{`Release note by ${note.author}`}</p>
          <ul className="space-y-2">
            {note.items.map((item) => (
              <li key={item.change} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
                <p className="font-[550]">{item.change}</p>
                {item.covered ? (
                  <p className="text-[hsl(var(--e-text-secondary))]">{`Covered: ${findTour(item.covered.tourKey)?.title ?? item.covered.tourKey} v${item.covered.version}, steps ${item.covered.stepIds.join(", ")}`}</p>
                ) : (
                  <p className="text-[hsl(var(--e-text-secondary))]">{`No visible change: "${item.noVisibleChange}"`}</p>
                )}
              </li>
            ))}
          </ul>
        </ECard>
      ))}
      <ECard className="min-w-0 space-y-2 p-4">
        <h2 className="text-[1rem] font-[600]">Marked &quot;no visible change&quot; by developers</h2>
        {notes.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">None yet. Every change to a page with a tour so far came with a tour update.</p>
        ) : (
          <ul className="space-y-1.5">
            {notes.map((note) => (
              <li key={`${note.tourKey}:${note.fingerprint}`} className="text-[0.8125rem]">{`${findTour(note.tourKey)?.title ?? note.tourKey}: "${note.reason}" · ${note.by} · ${note.date}`}</li>
            ))}
          </ul>
        )}
      </ECard>
    </div>
  );
}

/* ── People ────────────────────────────────────────────────────────────── */

type Person = { id: string; name: string | null; email: string; role: string; createdAt: string };
type PersonTours = { person: Person; toursOn: boolean; progress: TourProgressRecord[] };

function PeopleTab({ canEdit, timezone }: { canEdit: boolean; timezone: string }) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Person[] | null>(null);
  const [selected, setSelected] = React.useState<PersonTours | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [resetting, setResetting] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/tutorials/people?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        setResults(response.ok ? (body?.people ?? []) : []);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const open = async (id: string) => {
    setError(null);
    setSelected(null);
    const response = await fetch(`/api/admin/tutorials/people/${encodeURIComponent(id)}`).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body) setError(body?.error ?? "That person's tours could not be loaded.");
    else setSelected(body as PersonTours);
  };

  const patch = async (body: { toursOn?: boolean; reset?: string }) => {
    if (!selected) return false;
    setBusy(true);
    const result = await sendJson(`/api/admin/tutorials/people/${encodeURIComponent(selected.person.id)}`, "PATCH", body);
    setBusy(false);
    if (!result.ok) {
      setError(`It was not saved: ${result.data?.error ?? "the server refused the change."}`);
      return false;
    }
    setSelected({ ...selected, toursOn: result.data.toursOn, progress: result.data.progress });
    return true;
  };

  const firstName = selected?.person.name?.split(" ")[0] ?? "this person";
  const personRole = selected?.person.role as TourRole | undefined;
  const theirTours = personRole ? TOURS.filter((tour) => tour.roles.includes(personRole)) : [];

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <ECard className="min-w-0 space-y-2 p-4">
        <label htmlFor="tour-people-search" className="text-[0.8125rem] font-[600]">Find a person</label>
        <input id="tour-people-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" className="h-11 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[16px] sm:text-[0.875rem]" />
        {results === null ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Type at least two letters.</p> : null}
        {results && results.length === 0 ? <p role="status" className="text-[0.8125rem]">No matching people.</p> : null}
        <ul className="divide-y divide-[hsl(var(--e-border))]">
          {(results ?? []).map((person) => (
            <li key={person.id}><button type="button" onClick={() => void open(person.id)} className="min-h-11 w-full py-2 text-left text-[0.875rem]"><span className="font-[550]">{person.name ?? person.email}</span> <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{person.role}</span></button></li>
          ))}
        </ul>
      </ECard>
      <ECard className="min-w-0 space-y-3 p-4">
        {error ? <p role="alert" className="text-[0.8125rem]">{error}</p> : null}
        {!selected ? <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Choose a person to see their tours.</p> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-[1rem] font-[600]">{selected.person.name ?? selected.person.email}</h2>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{`${selected.person.role} · joined ${formatInTimeZone(selected.person.createdAt, timezone, "d MMM yyyy")}`}</p>
              </div>
              <Switch label={`Tours on for ${firstName}`} checked={selected.toursOn} disabled={!canEdit || busy} onChange={(value) => void patch({ toursOn: value })} />
            </div>
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {theirTours.map((tour) => {
                const record = selected.progress.find((entry) => entry.tourKey === tour.key);
                return (
                  <li key={tour.key} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 text-[0.875rem]">{`${tour.title} v${tour.version}`}</span>
                    <PersonStatus record={record} tour={tour} timezone={timezone} />
                    {canEdit && record ? <EButton variant="outline" size="sm" disabled={busy} onClick={() => setResetting(tour.key)}>Reset</EButton> : null}
                  </li>
                );
              })}
            </ul>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{`Reset makes the tour show again on ${firstName}'s next visit. Their work isn't touched.`}</p>
            {canEdit ? <EButton variant="outline" size="sm" disabled={busy || selected.progress.length === 0} onClick={() => setResetting("all")}>{`Reset all of ${firstName}'s tours…`}</EButton> : null}
          </>
        )}
      </ECard>
      <EConfirmDialog
        open={resetting !== null}
        onClose={() => { if (!busy) setResetting(null); }}
        tier="ordinary"
        title={resetting === "all" ? `Reset all of ${firstName}'s tours?` : `Reset ${findTour(resetting ?? "")?.title ?? "this"} tour for ${firstName}?`}
        description="It shows again on their next visit. Only tour progress changes."
        confirmLabel="Reset"
        busy={busy}
        onConfirm={async () => { if (resetting && (await patch({ reset: resetting }))) setResetting(null); }}
      />
    </div>
  );
}

function PersonStatus({ record, tour, timezone }: { record: TourProgressRecord | undefined; tour: TourDefinition; timezone: string }) {
  if (!record || record.status === "NOT_STARTED") return <EPill>Not started</EPill>;
  if (record.status === "DONE") return <EPill tone="ok">{`Done ${record.completedAt ? formatInTimeZone(record.completedAt, timezone, "d MMM") : ""}`.trim()}</EPill>;
  if (record.status === "DISMISSED") return <EPill>Don&apos;t show again</EPill>;
  if (record.status === "SKIPPED") return <EPill>Skipped</EPill>;
  return <EPill tone="warn">{`Stopped at step ${record.currentStep + 1} of ${tour.steps.length}`}</EPill>;
}

/* ── Switches ──────────────────────────────────────────────────────────── */

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-[0.875rem]">
      <span className="min-w-0 flex-1">{label}</span>
      <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{checked ? "On" : "Off"}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-[hsl(var(--e-border-strong))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50", checked ? "bg-[hsl(var(--e-primary))]" : "bg-[hsl(var(--e-muted))]")}
      >
        <span aria-hidden="true" className={cn("absolute h-5 w-5 rounded-full bg-[hsl(var(--e-surface))] shadow", checked ? "left-6" : "left-1")} />
      </button>
    </label>
  );
}

function SwitchesTab({ roles, canEdit, onSaved }: { roles: Record<TourRole, boolean>; canEdit: boolean; onSaved: () => void }) {
  const [busy, setBusy] = React.useState<TourRole | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const toggle = async (role: TourRole, value: boolean) => {
    setBusy(role);
    setError(null);
    const result = await sendJson("/api/admin/tutorials", "PATCH", { role, toursOn: value });
    setBusy(null);
    if (!result.ok) setError(`It was not saved: ${result.data?.error ?? "the server refused the change."}`);
    else onSaved();
  };
  return (
    <ECard className="max-w-xl space-y-1 p-4">
      <h2 className="text-[1rem] font-[600]">Tours by role</h2>
      {TOUR_ROLES.map((role) => (
        <Switch key={role} label={TOUR_ROLE_LABELS[role]} checked={roles[role] !== false} disabled={!canEdit || busy !== null} onChange={(value) => void toggle(role, value)} />
      ))}
      {error ? <p role="alert" className="text-[0.8125rem]">{error}</p> : null}
      <p className="pt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Off stops tours and What&apos;s new popping up for that role; Help still lists them. Fixed: no tour ever starts during a running clock.</p>
    </ECard>
  );
}

/* ── Preview as a role ─────────────────────────────────────────────────── */

function PreviewButton() {
  const [open, setOpen] = React.useState(false);
  const [role, setRole] = React.useState<TourRole>("CLEANER");
  const tours = TOURS.filter((tour) => tour.roles.includes(role));
  const [tourKey, setTourKey] = React.useState<string>(tours[0]?.key ?? "");
  const [index, setIndex] = React.useState(0);
  const tour = findTour(tourKey) ?? tours[0];
  const steps = tour ? resolveSteps(tour) : [];
  const step = steps[Math.min(index, steps.length - 1)];

  return (
    <>
      <EButton variant="outline" size="sm" onClick={() => setOpen(true)}><Eye className="h-4 w-4" aria-hidden /> Preview as…</EButton>
      <EBottomSheet open={open} onOpenChange={setOpen} title="Preview as a role" description="Shows the tour's cards as that role sees them. It signs in as nobody and records nothing.">
        <div className="space-y-3 px-5 pb-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[0.75rem] font-[550]">Role
              <select value={role} onChange={(event) => { const next = event.target.value as TourRole; setRole(next); setTourKey(TOURS.find((entry) => entry.roles.includes(next))?.key ?? ""); setIndex(0); }} className="h-11 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[16px]">
                {TOUR_ROLES.map((entry) => <option key={entry} value={entry}>{TOUR_ROLE_LABELS[entry]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[0.75rem] font-[550]">Tour
              <select value={tour?.key ?? ""} onChange={(event) => { setTourKey(event.target.value); setIndex(0); }} className="h-11 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[16px]">
                {tours.map((entry) => <option key={entry.key} value={entry.key}>{`${entry.title} · ${kindLabel(entry)}`}</option>)}
              </select>
            </label>
          </div>
          <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-band-info-line))] bg-[hsl(var(--e-band-info-bg))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-band-info-fg))]">{`Preview as ${TOUR_ROLE_LABELS[role].toLowerCase()} · nothing is recorded`}</p>
          {step && tour ? (
            <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-strong))] p-4" aria-live="polite">
              <div className="flex justify-between text-[0.6875rem] font-[600] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
                <span>{`Step ${Math.min(index, steps.length - 1) + 1} of ${steps.length}`}</span>
                {step.practice ? <span>Practice</span> : null}
              </div>
              <p className="mt-1 text-[1rem] font-[600]">{personalise(step.title, "Jane")}</p>
              <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{step.body}</p>
              <p className="mt-2 font-mono text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{step.target ? `Points at ${step.target} · ${TOUR_TARGETS[step.target].label}` : "Centred card"}</p>
              <div className="mt-3 flex justify-end gap-2">
                <EButton variant="outline" size="sm" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>Back</EButton>
                <EButton size="sm" disabled={index >= steps.length - 1} onClick={() => setIndex((value) => value + 1)}>Next</EButton>
              </div>
            </div>
          ) : null}
        </div>
      </EBottomSheet>
    </>
  );
}
