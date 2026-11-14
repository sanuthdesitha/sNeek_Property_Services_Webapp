"use client";

/**
 * Property onboarding list (board "Property onboarding"): tabs named for the
 * work, a readiness bar and the next missing item per row, and a checklist
 * preview of the selected row. Phones get cards with the title band.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { EToneNotice, ETonePill, tonePhoneBandClass, toneRowCellClass, type ETone } from "@/components/v2/ui/tone-band";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { sectionDef } from "@/lib/onboarding/workspace/sections";
import type { OnboardingBoardResponse, OnboardingBoardRow, OnboardingBoardTab } from "@/lib/onboarding/workspace/view-types";
import { ChecklistMark, ONB_INPUT_CLASS, onbInput, ONB_MUTED, ReadinessBar, formatSavedAt } from "./onboarding-kit";

const TABS: Array<{ key: OnboardingBoardTab; label: string; short: string }> = [
  { key: "open", label: "All open", short: "All open" },
  { key: "progress", label: "In progress", short: "In progress" },
  { key: "waiting", label: "Waiting on client", short: "Waiting" },
  { key: "ready", label: "Ready to activate", short: "Ready" },
  { key: "activated", label: "Activated, 30 days", short: "Activated" },
  { key: "rejected", label: "Rejected", short: "Rejected" },
];

const SOURCE_LABEL: Record<OnboardingBoardRow["sourceType"], string> = { ADMIN_CREATED: "Office", CLIENT_SUBMITTED: "Client link", WEB_FORM: "Web form" };

function rowTone(row: OnboardingBoardRow): ETone | null {
  if (row.tab === "waiting") return "attention";
  if (row.tab === "ready") return "good";
  if (row.tab === "rejected") return "problem";
  return null;
}

function sourceLabel(row: OnboardingBoardRow): string {
  return row.clientLink ? "Client link" : SOURCE_LABEL[row.sourceType];
}

function readinessLine(row: OnboardingBoardRow): { text: string; problem: boolean } {
  if (row.tab === "waiting" && row.clientLink) return { text: `client's part: ${row.clientLink.doneSections} of ${row.clientLink.sections.length}`, problem: false };
  if (row.readiness.missingRequired.length) return { text: `${row.readiness.missingRequired.length} required: ${row.readiness.missingRequired.map((label) => label.replace(/^Rate for .*/, "rates").toLowerCase()).join(", ")}`, problem: true };
  const skipped = row.readiness.recommendedTotal - row.readiness.recommendedDone;
  if (row.readiness.ready) return { text: skipped ? `${skipped} recommended open` : "everything done", problem: false };
  return { text: "basics only", problem: false };
}

function nextLabel(row: OnboardingBoardRow, timeZone: string): string {
  if (row.tab === "activated") return "Activated";
  if (row.tab === "rejected") return "Rejected";
  if (row.tab === "waiting" && row.clientLink) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(row.clientLink.createdAt).getTime()) / 86_400_000));
    return `Waiting on client, ${days} d`;
  }
  if (row.readiness.ready) return "Ready to activate";
  void timeZone;
  return row.readiness.next ? sectionDef(row.readiness.next.section).title : "Ready to activate";
}

function savedBy(row: OnboardingBoardRow): string | null {
  if (row.lastSavedSource === "CLIENT_SUBMITTED") return "client";
  return row.lastSavedByName;
}

function workspaceHref(row: OnboardingBoardRow, hash?: string): string {
  return `/v2/admin/onboarding/${encodeURIComponent(row.surveyNumber)}${hash ? `#${hash}` : ""}`;
}

function Preview({ row, timeZone }: { row: OnboardingBoardRow; timeZone: string }) {
  const tone = rowTone(row) ?? "info";
  const requiredLeft = row.readiness.requiredTotal - row.readiness.requiredDone;
  const sections = Array.from(new Map(row.readiness.items.map((item) => [item.section, item])).keys());
  return (
    <section aria-labelledby="preview-title" className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className={cn("flex items-start justify-between gap-2 px-4 py-3", tone === "info" ? "bg-[hsl(var(--e-band-attention-bg))]" : `bg-[hsl(var(--e-band-${tone}-bg))]`)}>
        <div className="min-w-0">
          <h2 id="preview-title" tabIndex={-1} className="break-words font-[600] outline-none">{row.propertyName || "Unnamed property"}</h2>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{[row.surveyNumber, row.clientName, sourceLabel(row)].filter(Boolean).join(" · ")}</p>
        </div>
        <ETonePill tone={requiredLeft ? "problem" : "good"}>{requiredLeft ? `${requiredLeft} required left` : "Required done"}</ETonePill>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-4">
          <div className="relative h-20 w-20 shrink-0 rounded-full" style={{ background: `conic-gradient(hsl(var(--e-primary)) ${row.readiness.percent * 3.6}deg, hsl(var(--e-muted)) 0deg)` }} aria-hidden>
            <div className="absolute inset-2 flex items-center justify-center rounded-full bg-[hsl(var(--e-surface))] font-serif text-[1.125rem]">{row.readiness.percent}%</div>
          </div>
          <div className="text-[0.8125rem]">
            <p className="font-[600]">Required {row.readiness.requiredDone} of {row.readiness.requiredTotal}</p>
            <p>Recommended {row.readiness.recommendedDone} of {row.readiness.recommendedTotal}</p>
            <p className={ONB_MUTED}>Saved {formatSavedAt(row.lastSavedAt, timeZone).toLowerCase()}{savedBy(row) ? ` by ${savedBy(row)}` : ""}</p>
          </div>
        </div>
        <ul className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
          {sections.map((section) => {
            const items = row.readiness.items.filter((item) => item.section === section);
            const missingRequired = items.some((item) => item.required && item.state !== "done");
            const allDone = items.every((item) => item.state !== "missing");
            const asked = row.askedOfClient.includes(section);
            const mark = missingRequired ? "required" : allDone ? "done" : asked ? "client" : "recommended";
            const detail = missingRequired ? "required" : asked && !allDone ? "client's part, sent" : allDone ? items[0].detail : "recommended";
            return (
              <li key={section} className="flex items-center gap-2 py-1.5">
                <ChecklistMark mark={mark} className="h-5 w-5" />
                <span className={cn("flex-1", missingRequired && "font-[600]")}>{sectionDef(section).title}</span>
                <span className={cn("max-w-[45%] truncate text-right text-[0.75rem]", missingRequired ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]")}>{detail}</span>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          <EButton asChild className="flex-1"><Link href={workspaceHref(row, row.readiness.next?.section ?? "readiness")}>{row.tab === "activated" || row.tab === "rejected" ? "Open" : "Continue"}</Link></EButton>
          {row.tab !== "activated" && row.tab !== "rejected" ? <EButton asChild variant="outline"><Link href={`${workspaceHref(row)}?send=1`}>Send link to client…</Link></EButton> : null}
        </div>
        <p className={ONB_MUTED}>C = the client was asked to fill this part. The office can still fill or change it.</p>
      </div>
    </section>
  );
}

function PhoneCards({ rows, timeZone }: { rows: OnboardingBoardRow[]; timeZone: string }) {
  return (
    <ul className="space-y-3 sm:hidden">
      {rows.map((row) => {
        const tone = rowTone(row);
        const requiredLeft = row.readiness.requiredTotal - row.readiness.requiredDone;
        const pill = row.tab === "waiting" ? `Waiting ${row.clientLink ? Math.max(0, Math.floor((Date.now() - new Date(row.clientLink.createdAt).getTime()) / 86_400_000)) : 0} d` : row.tab === "ready" ? "Ready" : requiredLeft ? `${requiredLeft} required` : row.tab === "activated" ? "Activated" : "";
        return (
          <li key={row.id} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
            <div className={cn("flex items-start justify-between gap-2 px-3 py-2.5", tone ? tonePhoneBandClass(tone) : "")}>
              <Link href={workspaceHref(row, row.readiness.next?.section)} className="min-w-0">
                <span className="block break-words font-[600]">{row.propertyName || "Unnamed property"}</span>
                <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{[row.clientName, row.clientLink ? "client link" : row.sourceType === "WEB_FORM" ? "web form" : row.surveyNumber].filter(Boolean).join(" · ")}</span>
              </Link>
              {pill ? <ETonePill tone={tone ?? "problem"}>{pill}</ETonePill> : null}
            </div>
            <div className="space-y-2 px-3 py-2.5">
              {row.tab === "ready" ? (
                <EButton asChild variant="outline" className="w-full"><Link href={workspaceHref(row, "readiness")}>Review and activate</Link></EButton>
              ) : (
                <>
                  <div className="flex items-center gap-2"><ReadinessBar percent={row.readiness.percent} label={`${row.propertyName ?? row.surveyNumber} readiness`} /><span className="text-[0.75rem]">{row.readiness.percent}%</span></div>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {row.tab === "waiting" && row.clientLink ? <>Client part <b>{row.clientLink.doneSections} of {row.clientLink.sections.length}</b>{row.clientLink.openedAt ? ` · opened ${formatSavedAt(row.clientLink.openedAt, timeZone)}` : " · not opened"}</> : <>Next <b>{nextLabel(row, timeZone)}</b> · {formatSavedAt(row.lastSavedAt, timeZone)}</>}
                  </p>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type EmptyDraft = { id: string; surveyNumber: string; createdAt: string; startedByName: string | null };

/** One-off, admin-only review of drafts with no answers. Nothing is deleted without a deliberate choice. */
function EmptyDraftsReview({ timeZone, onDeleted }: { timeZone: string; onDeleted: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [drafts, setDrafts] = React.useState<EmptyDraft[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const response = await fetch("/api/admin/onboarding/empty-drafts", { cache: "no-store", signal });
      const body = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (!response.ok) throw new Error(body?.error ?? "The drafts could not be listed.");
      setDrafts(body.drafts as EmptyDraft[]);
    } catch (loadError) {
      if (!signal?.aborted) setError(loadError instanceof Error ? loadError.message : "The drafts could not be listed.");
    }
  }, []);

  React.useEffect(() => {
    if (!open || drafts !== null) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [open, drafts, load]);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/onboarding/empty-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Nothing was deleted.");
      const results = body.results as Array<{ id: string; outcome: string }>;
      const deleted = results.filter((entry) => entry.outcome === "deleted").length;
      setResult(`${deleted} deleted${deleted < results.length ? `, ${results.length - deleted} kept because they now hold answers or are gone` : ""}.`);
      setSelected(new Set());
      setConfirming(false);
      setDrafts(null);
      onDeleted();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Nothing was deleted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="empty-drafts" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <h2 id="empty-drafts" className="text-[0.875rem]">
        <button type="button" aria-expanded={open} aria-controls="empty-drafts-panel" className="flex min-h-11 w-full flex-col items-start px-4 py-2 text-left" onClick={() => setOpen((value) => !value)}>
          <span className="font-[600]">Review empty drafts</span>
          <span className={ONB_MUTED}>Lists drafts with no answers, left by the old page that made a draft on opening. Deletes only the ones you pick.</span>
        </button>
      </h2>
      <div id="empty-drafts-panel" hidden={!open} className="space-y-3 border-t border-[hsl(var(--e-border))] p-4">
        {error ? <EToneNotice tone="problem" role="alert">{error}</EToneNotice> : null}
        {result ? <EToneNotice tone="good" role="status">{result}</EToneNotice> : null}
        {drafts === null && !error ? <p role="status" className={ONB_MUTED}>Loading…</p> : null}
        {drafts && drafts.length === 0 ? <p className={ONB_MUTED}>No empty drafts.</p> : null}
        {drafts && drafts.length > 0 ? (
          <>
            <label className="flex min-h-11 items-center gap-2 text-[0.8125rem]"><input type="checkbox" checked={selected.size === drafts.length} onChange={(event) => setSelected(event.target.checked ? new Set(drafts.map((draft) => draft.id)) : new Set())} /> Select all {drafts.length}</label>
            <ul className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto text-[0.8125rem]">
              {drafts.map((draft) => (
                <li key={draft.id}>
                  <label className="flex min-h-10 items-center gap-2">
                    <input type="checkbox" checked={selected.has(draft.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(draft.id); else next.delete(draft.id); return next; })} />
                    <span className="font-[550]">{draft.surveyNumber}</span>
                    <span className={ONB_MUTED}>opened {formatSavedAt(draft.createdAt, timeZone)}{draft.startedByName ? ` by ${draft.startedByName}` : ""}</span>
                  </label>
                </li>
              ))}
            </ul>
            <EButton variant="danger" size="sm" disabled={selected.size === 0} onClick={() => setConfirming(true)}>Delete {selected.size || ""} selected</EButton>
          </>
        ) : null}
      </div>
      <EConfirmDialog
        open={confirming}
        onClose={() => { if (!busy) setConfirming(false); }}
        tier="destructive"
        title={`Delete ${selected.size} empty draft${selected.size === 1 ? "" : "s"}?`}
        description="Removes drafts that hold no answers. Each is checked again first; one that now has answers is kept. This cannot be undone."
        confirmLabel="Delete drafts"
        busy={busy}
        error={confirming ? error : null}
        onConfirm={() => remove()}
      />
    </section>
  );
}

export function OnboardingList({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const tab: OnboardingBoardTab = TABS.some((entry) => entry.key === tabParam) ? (tabParam as OnboardingBoardTab) : "open";
  const [search, setSearch] = React.useState(params.get("search") ?? "");
  const [source, setSource] = React.useState("any");
  const [startedBy, setStartedBy] = React.useState("anyone");
  const [data, setData] = React.useState<OnboardingBoardResponse | null>(null);
  const [state, setState] = React.useState<{ kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string }>({ kind: "loading" });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/onboarding/board?tab=${tab}&search=${encodeURIComponent(search.trim())}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (controller.signal.aborted) return;
          if (!response.ok) throw new Error(body?.error ?? "The onboarding list could not be loaded.");
          setData(body as OnboardingBoardResponse);
          setState({ kind: "ready" });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setState({ kind: "failed", message: error instanceof Error ? error.message : "The onboarding list could not be loaded." });
        });
    }, search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [tab, search, reloadKey]);

  const setTab = (next: OnboardingBoardTab) => {
    const query = new URLSearchParams(params.toString());
    if (next === "open") query.delete("tab");
    else query.set("tab", next);
    setSelectedId(null);
    router.replace(`/v2/admin/onboarding${query.toString() ? `?${query}` : ""}`, { scroll: false });
  };

  const timeZone = data?.timezone ?? "Australia/Sydney";
  const starters = Array.from(new Set((data?.rows ?? []).map((row) => row.startedByName).filter((name): name is string => Boolean(name))));
  const rows = (data?.rows ?? []).filter((row) => (source === "any" || sourceLabel(row) === source) && (startedBy === "anyone" || row.startedByName === startedBy));
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const counts = data?.counts;
  const stale = state.kind === "failed" && data !== null;

  return (
    <div className="space-y-5">
      <EPageHeader
        title="Property onboarding"
        description="Every new property from first call to activation, as a checklist you can leave and come back to. A draft appears here on its first save; opening Start onboarding creates nothing."
        actions={<EButton asChild className="max-sm:hidden"><Link href="/v2/admin/onboarding/new">Start onboarding</Link></EButton>}
      />
      <EPhoneActionBar label="Onboarding actions" primary={<EButton asChild className="w-full"><Link href="/v2/admin/onboarding/new">+ Start</Link></EButton>} />
      {counts ? <p className={`${ONB_MUTED} sm:hidden`}>{counts.open} open · {counts.ready} ready to activate · {counts.waiting} waiting on a client</p> : null}
      <EFilterChips
        label="Onboarding status"
        phoneLayout="carousel"
        active={tab}
        onChange={setTab}
        chips={TABS.map((entry) => ({ key: entry.key, label: entry.label, count: counts ? counts[entry.key] : null }))}
      />
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="onboarding-search">Search property, client, address or OB number</label>
        <input id="onboarding-search" className={onbInput("min-w-0 flex-1 sm:min-w-[16rem]")} placeholder="Search property, client, address or OB number" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="sr-only" htmlFor="onboarding-source">Source</label>
        <select id="onboarding-source" className={onbInput("w-auto max-sm:flex-1")} value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="any">Source: any</option><option value="Office">Office</option><option value="Client link">Client link</option><option value="Web form">Web form</option>
        </select>
        <label className="sr-only" htmlFor="onboarding-started">Started by</label>
        <select id="onboarding-started" className={onbInput("w-auto max-sm:flex-1")} value={startedBy} onChange={(event) => setStartedBy(event.target.value)}>
          <option value="anyone">Started by: anyone</option>
          {starters.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>

      {stale ? <EToneNotice tone="attention" role="alert">Showing the last list loaded. {state.kind === "failed" ? state.message : ""} <button type="button" className="font-[600] underline" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></EToneNotice> : null}
      {state.kind === "failed" && !data ? <EToneNotice tone="problem" role="alert" title="The onboarding list could not be loaded">{state.message} <button type="button" className="font-[600] underline" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></EToneNotice> : null}
      {state.kind === "loading" && !data ? <p role="status" className={ONB_MUTED}>Loading onboardings…</p> : null}
      {data && rows.length === 0 && state.kind !== "loading" ? <p className={ONB_MUTED}>{search || source !== "any" || startedBy !== "anyone" ? "No onboarding matches these filters." : tab === "open" ? "No onboarding in progress. Start one with Start onboarding." : "None here."}</p> : null}

      {rows.length > 0 ? (
        <div className={cn("grid grid-cols-1 gap-5", "xl:grid-cols-[minmax(0,1fr)_19rem]")} aria-busy={state.kind === "loading"}>
          <div className="min-w-0 space-y-2">
            <div role="region" aria-label="Onboardings" tabIndex={0} className="overflow-x-auto rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] max-sm:hidden">
              <table className="w-full min-w-[40rem] text-[0.8125rem]">
                <thead className="text-left text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  <tr className="border-b border-[hsl(var(--e-border))]">
                    <th className="px-3 py-2.5 font-[550]">Property</th><th className="px-3 py-2.5 font-[550]">Client</th><th className="hidden px-3 py-2.5 font-[550] 2xl:table-cell">Source</th><th className="px-3 py-2.5 font-[550]">Readiness</th><th className="px-3 py-2.5 font-[550]">Next</th><th className="px-3 py-2.5 font-[550]">Last saved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--e-border))]">
                  {rows.map((row) => {
                    const tone = rowTone(row);
                    const line = readinessLine(row);
                    const isSelected = selected?.id === row.id;
                    return (
                      <tr key={row.id} onClick={() => setSelectedId(row.id)} className={cn("cursor-pointer align-top", isSelected && "bg-[hsl(var(--e-primary-soft))]")}>
                        <td className={cn("px-3 py-2.5", tone && !isSelected ? toneRowCellClass(tone) : "")}>
                          <button type="button" className="text-left font-[600] hover:underline" aria-pressed={isSelected} onClick={(event) => { event.stopPropagation(); setSelectedId(row.id); }}>{row.propertyName || "Unnamed property"}</button>
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.surveyNumber}<span className="2xl:hidden"> · {sourceLabel(row)}</span> · {row.tab === "waiting" && row.clientLink ? (row.clientLink.openedAt ? `Client link opened ${formatSavedAt(row.clientLink.openedAt, timeZone)}, not finished` : "Client link not opened yet") : row.tab === "ready" ? "All required done" : row.address ?? "No address yet"}</p>
                        </td>
                        <td className="px-3 py-2.5">{row.clientName?.replace(/ \(new client\)$/, "") ?? <span className={ONB_MUTED}>No client</span>}{row.isNewClient ? <span className="mt-1 block"><ETonePill tone="info">new client</ETonePill></span> : null}</td>
                        <td className="hidden px-3 py-2.5 2xl:table-cell">{sourceLabel(row)}</td>
                        <td className="w-40 px-3 py-2.5">
                          <div className="flex items-center gap-2"><ReadinessBar percent={row.readiness.percent} label={`${row.propertyName ?? row.surveyNumber} readiness`} /><span className="e-tnum">{row.readiness.percent}%</span></div>
                          <p className={cn("mt-1 text-[0.75rem]", line.problem ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]")}>{line.text}</p>
                        </td>
                        <td className={cn("px-3 py-2.5", row.readiness.ready && row.tab === "ready" && "font-[600]")}>
                          <Link href={workspaceHref(row, row.readiness.next?.section ?? "readiness")} className="hover:underline" onClick={(event) => event.stopPropagation()}>{nextLabel(row, timeZone)}</Link>
                        </td>
                        <td className="px-3 py-2.5">{formatSavedAt(row.lastSavedAt, timeZone)}<span className="block text-[hsl(var(--e-muted-foreground))]">{savedBy(row) === "client" ? `${row.clientName?.replace(/ \(new client\)$/, "") ?? "Client"} (client)` : savedBy(row) ?? ""}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PhoneCards rows={rows} timeZone={timeZone} />
            <p className={`${ONB_MUTED} max-sm:hidden`}>Readiness counts required items (client, name, address, at least one job type, access, a rate for the main job type) and recommended items (rooms, laundry, stock, checklist, photos, other rates, calendar, house rules). It is the approval check, shown before you press Activate.</p>
          </div>
          {selected ? <div className="max-xl:hidden"><Preview key={selected.id} row={selected} timeZone={timeZone} /></div> : null}
        </div>
      ) : null}

      <EToneNotice tone="info" className="max-sm:hidden" title="Future idea, not built">&quot;Import from a listing URL&quot; (Airbnb or Stayz page) to prefill name, suburb, rooms and photos is not part of this design.</EToneNotice>
      {isAdmin ? <EmptyDraftsReview timeZone={timeZone} onDeleted={() => setReloadKey((value) => value + 1)} /> : null}
    </div>
  );
}
