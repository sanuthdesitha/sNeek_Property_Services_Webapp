"use client";

/**
 * Report themes (board "Report themes", 2026-11-17): three columns — the
 * themes, the editor and a page preview from a recent job. The editor keeps
 * every existing setting (style, photo size, density, logo, two colours,
 * title, footer, sections on or off and their order) grouped as Look, Brand
 * and Sections. Same endpoints:
 *
 *   GET    /api/admin/report-themes?all=1          → { themes (+ _count.reports) }
 *   POST   /api/admin/report-themes                { name }
 *   PATCH  /api/admin/report-themes/[id]           { …, expectedUpdatedAt } (409 when someone saved since)
 *   POST   /api/admin/report-themes/[id]/set-default
 *   DELETE /api/admin/report-themes/[id]           (switch off: a soft delete)
 *   POST   /api/admin/report-themes/preview        { jobId, theme } → { html } (read only)
 *   GET    /api/admin/report-themes/preview-jobs   → { jobs }
 *
 * Make default and Switch off are tier A and say what happens to reports
 * already made. There is no per-client theme (the data has none); the page
 * says so. The footer is plain text with links. Read only without write access.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import {
  ESTATE_REPORT_COLOURS,
  READABLE_CONTRAST,
  REPORT_SECTIONS,
  TITLE_VARIABLES,
  footerPlainText,
  hslToHex,
  normalizeThemeLayout,
  parseHsl,
  unknownTitleVariables,
  whiteTextContrast,
  type ThemeLayout,
} from "@/lib/reports/theme-rules";

type ReportTheme = {
  id: string;
  name: string;
  kind: string;
  isDefault: boolean;
  isActive: boolean;
  layout: ThemeLayout;
  logoUrl: string | null;
  primaryColorHsl: string | null;
  accentColorHsl: string | null;
  titleTemplate: string | null;
  footerHtml: string | null;
  updatedAt: string;
  _count?: { reports: number };
};

type Draft = Pick<ReportTheme, "name" | "layout" | "logoUrl" | "primaryColorHsl" | "accentColorHsl" | "titleTemplate" | "footerHtml">;
type PreviewJob = { id: string; jobNumber: string | null; propertyName: string };
type Confirm = { kind: "default" | "off"; theme: ReportTheme } | null;

const STYLES: ReadonlyArray<{ key: NonNullable<ThemeLayout["template"]>; label: string }> = [
  { key: "estate", label: "Estate" },
  { key: "classic", label: "Classic" },
  { key: "luxury", label: "Luxury" },
];
const PHOTO_SIZES: ReadonlyArray<{ key: ThemeLayout["photoSize"]; label: string }> = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
  { key: "hero", label: "Hero" },
];
const DENSITIES: ReadonlyArray<{ key: ThemeLayout["density"]; label: string }> = [
  { key: "compact", label: "Compact" },
  { key: "default", label: "Default" },
  { key: "comfortable", label: "Comfortable" },
];
const SECTION_LABEL = Object.fromEntries(REPORT_SECTIONS.map((section) => [section.id, section.label])) as Record<string, string>;

function normalizeTheme(raw: ReportTheme): ReportTheme {
  return { ...raw, layout: normalizeThemeLayout(raw.layout), footerHtml: footerPlainText(raw.footerHtml) || null };
}

function draftOf(theme: ReportTheme): Draft {
  return { name: theme.name, layout: theme.layout, logoUrl: theme.logoUrl, primaryColorHsl: theme.primaryColorHsl, accentColorHsl: theme.accentColorHsl, titleTemplate: theme.titleTemplate, footerHtml: theme.footerHtml };
}

/** The style a theme without an explicit template uses (the generator's own rule). */
function styleOf(theme: Pick<ReportTheme, "layout">): NonNullable<ThemeLayout["template"]> {
  return theme.layout.template ?? "classic";
}

function colourName(hsl: string | null): string {
  if (!hsl) return "Not set (the report's own colour)";
  if (hsl.replace(/\s+/g, " ").trim() === ESTATE_REPORT_COLOURS.primary.hsl) return ESTATE_REPORT_COLOURS.primary.name;
  if (hsl.replace(/\s+/g, " ").trim() === ESTATE_REPORT_COLOURS.accent.hsl) return ESTATE_REPORT_COLOURS.accent.name;
  return parseHsl(hsl) ? "Custom colour" : "Not a colour this report can read";
}

function Segmented<T extends string>({ label, options, value, onChange, disabled }: { label: string; options: ReadonlyArray<{ key: T; label: string }>; value: T; onChange: (value: T) => void; disabled: boolean }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))]">
        {options.map((option, index) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={value === option.key}
            disabled={disabled}
            onClick={() => onChange(option.key)}
            className={cn("min-h-10 flex-1 px-3 text-[0.8125rem] font-[550] max-sm:min-h-11", index > 0 && "border-l border-[hsl(var(--e-border))]", value === option.key ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "text-[hsl(var(--e-text-secondary))]")}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Swatches({ theme }: { theme: Pick<ReportTheme, "primaryColorHsl" | "accentColorHsl"> }) {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {[theme.primaryColorHsl, theme.accentColorHsl].map((hsl, index) => (
        <span key={index} className="h-4 w-4 rounded-[4px] border border-[hsl(var(--e-border))]" style={{ background: hslToHex(hsl) ?? "transparent" }} />
      ))}
    </span>
  );
}

function ColourField({ label, value, onChange, disabled }: { label: string; value: string | null; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <span className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">{label}</span>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]" style={{ background: hslToHex(value) ?? "transparent" }} />
        <div className="min-w-0 flex-1">
          <EInput aria-label={`${label} (hue saturation lightness)`} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder="158 42% 20%" className="h-9 font-mono text-[0.8125rem] max-sm:h-11 max-sm:text-base" />
          <span className="block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{colourName(value)}</span>
        </div>
      </div>
    </div>
  );
}

function usePreview(draft: Draft | null, theme: ReportTheme | null, jobId: string) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "failed"; html?: string; error?: string }>({ status: "idle" });
  const body = useMemo(() => (draft && theme ? JSON.stringify({ jobId, theme: { ...draft, id: theme.id, kind: theme.kind } }) : null), [draft, theme, jobId]);
  useEffect(() => {
    if (!body || !jobId) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, status: "loading" }));
      fetch("/api/admin/report-themes/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as { html?: string; error?: string };
          if (controller.signal.aborted) return;
          if (!res.ok || typeof data.html !== "string") throw new Error(data.error ?? "The preview could not be made.");
          setState({ status: "ready", html: data.html });
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setState({ status: "failed", error: cause instanceof Error ? cause.message : "The preview could not be made." });
        });
    }, 600);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [body, jobId]);
  return state;
}

export function ThemeManager({ canWrite = true }: { canWrite?: boolean }) {
  const [themes, setThemes] = useState<ReportTheme[]>([]);
  const [load, setLoad] = useState<{ status: "loading" | "failed" | "ready"; error: string | null }>({ status: "loading", error: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ReportTheme | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ status: "loading" | "failed" | "ready"; rows: PreviewJob[] }>({ status: "loading", rows: [] });
  const [jobId, setJobId] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoad((current) => ({ status: "loading", error: current.error }));
    try {
      const res = await fetch("/api/admin/report-themes?all=1", { cache: "no-store", signal });
      const data = await res.json().catch(() => ({}));
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(data.error ?? "Report themes could not be loaded. Try again.");
      const rows: ReportTheme[] = Array.isArray(data.themes) ? data.themes.map(normalizeTheme) : [];
      setThemes(rows);
      setLoad({ status: "ready", error: null });
      return rows;
    } catch (cause) {
      if (!signal?.aborted) setLoad({ status: "failed", error: cause instanceof Error ? cause.message : "Report themes could not be loaded." });
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    fetch("/api/admin/report-themes/preview-jobs", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { jobs?: PreviewJob[] };
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error("jobs");
        const rows = data.jobs ?? [];
        setJobs({ status: "ready", rows });
        if (rows[0]) setJobId((current) => current || rows[0].id);
      })
      .catch(() => {
        if (!controller.signal.aborted) setJobs({ status: "failed", rows: [] });
      });
    return () => controller.abort();
  }, [reload]);

  const selected = themes.find((theme) => theme.id === selectedId) ?? null;

  // Open the default (or first active) theme once the list arrives.
  useEffect(() => {
    if (selectedId || themes.length === 0) return;
    const first = themes.find((theme) => theme.isDefault) ?? themes.find((theme) => theme.isActive) ?? themes[0];
    setSelectedId(first.id);
    setDraft(draftOf(first));
  }, [themes, selectedId]);

  const dirty = Boolean(selected && draft && JSON.stringify(draftOf(selected)) !== JSON.stringify(draft));
  const preview = usePreview(draft, selected, jobId);
  const locked = !canWrite || saving;
  const contrast = whiteTextContrast(draft?.primaryColorHsl ?? null);
  const badTitle = unknownTitleVariables(draft?.titleTemplate);

  const [pendingTheme, setPendingTheme] = useState<ReportTheme | null>(null);

  function choose(theme: ReportTheme) {
    if (dirty && canWrite && theme.id !== selectedId) {
      setPendingTheme(theme);
      return;
    }
    open(theme);
  }

  function open(theme: ReportTheme) {
    setSelectedId(theme.id);
    setDraft(draftOf(theme));
    setError(null);
    setConflict(null);
    setStatus(null);
  }

  function patch(next: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }
  function patchLayout(next: Partial<ThemeLayout>) {
    setDraft((current) => (current ? { ...current, layout: { ...current.layout, ...next } } : current));
  }
  function moveSection(index: number, direction: -1 | 1) {
    if (!draft) return;
    const sections = draft.layout.sections.slice();
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    [sections[index], sections[target]] = [sections[target], sections[index]];
    patchLayout({ sections: sections.map((section, order) => ({ ...section, order })) });
  }
  function insertTitleVariable(token: string) {
    if (!draft) return;
    const element = titleRef.current;
    const value = draft.titleTemplate ?? "";
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    patch({ titleTemplate: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function createTheme() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/report-themes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "New theme" }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.theme) {
        setStatus(null);
        setError(`The theme was not created: ${data.error ?? `the server answered ${res.status}`}.`);
        return;
      }
      const rows = await reload();
      const created = rows?.find((theme) => theme.id === data.theme.id) ?? normalizeTheme(data.theme);
      setSelectedId(created.id);
      setDraft(draftOf(created));
    } finally {
      setCreating(false);
    }
  }

  async function save() {
    if (!selected || !draft) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/report-themes/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, expectedUpdatedAt: selected.updatedAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflict(data.current ? normalizeTheme(data.current) : null);
        setError(data.error ?? "Someone else saved this theme. Your changes are kept.");
        return;
      }
      if (!res.ok || !data.theme) {
        setError(`The theme was not saved: ${data.error ?? `the server answered ${res.status}`}. Your changes are kept.`);
        return;
      }
      const saved = normalizeTheme({ ...selected, ...data.theme });
      setThemes((current) => current.map((theme) => (theme.id === saved.id ? { ...saved, _count: theme._count } : theme)));
      setDraft(draftOf(saved));
      setStatus("Theme saved. Future reports use it; sent PDFs keep their look until regenerated.");
    } catch {
      setError("The theme was not saved: the server could not be reached. Your changes are kept.");
    } finally {
      setSaving(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const res =
        confirm.kind === "default"
          ? await fetch(`/api/admin/report-themes/${confirm.theme.id}/set-default`, { method: "POST" })
          : await fetch(`/api/admin/report-themes/${confirm.theme.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConfirmError(`It was not changed: ${data.error ?? `the server answered ${res.status}`}.`);
        return;
      }
      setConfirm(null);
      await reload();
    } finally {
      setConfirmBusy(false);
    }
  }

  async function switchOn(theme: ReportTheme) {
    const res = await fetch(`/api/admin/report-themes/${theme.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: true }) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(`It was not switched on: ${data.error ?? `the server answered ${res.status}`}.`);
      return;
    }
    await reload();
  }

  const active = themes.filter((theme) => theme.isActive);
  const off = themes.filter((theme) => !theme.isActive);
  const jobLabel = (job: PreviewJob) => `${job.propertyName || "Property"} · ${job.jobNumber ?? job.id.slice(0, 6)}`;
  const chosenJob = jobs.rows.find((job) => job.id === jobId) ?? null;

  const themeCard = (theme: ReportTheme) => (
    <li key={theme.id}>
      <button
        type="button"
        aria-current={selectedId === theme.id ? "true" : undefined}
        onClick={() => choose(theme)}
        className={cn("w-full rounded-[var(--e-radius-lg)] border p-3 text-left", selectedId === theme.id ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:bg-[hsl(var(--e-surface-raised))]")}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words font-[600]">{theme.name}</span>
          {theme.isDefault ? <EPill tone="ok">Default</EPill> : null}
        </span>
        {theme.isActive ? (
          <>
            <span className="mt-1.5 block"><Swatches theme={theme} /></span>
            <span className="mt-1 block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              {STYLES.find((style) => style.key === styleOf(theme))?.label} style · {theme.layout.photoSize} photos{theme.layout.density !== "default" ? ` · ${theme.layout.density}` : ""} · {theme.isDefault ? "used for new reports" : "picked when regenerating"}
            </span>
          </>
        ) : (
          <span className="mt-1 block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            {theme._count?.reports ? `Kept because ${theme._count.reports} past report${theme._count.reports === 1 ? "" : "s"} used it` : "Switched off"}
          </span>
        )}
      </button>
    </li>
  );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_minmax(0,28rem)]">
      <section aria-labelledby="themes-heading" className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="themes-heading" className="text-[0.9375rem] font-[600]">Themes</h2>
          {canWrite ? <EButton size="sm" variant="outline" disabled={creating} onClick={() => void createTheme()}><Plus className="h-3.5 w-3.5" /> New theme</EButton> : null}
        </div>
        {load.status === "loading" && themes.length === 0 ? (
          <div role="status" className="space-y-2"><span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Loading themes…</span>{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-surface-raised))]" />)}</div>
        ) : load.status === "failed" && themes.length === 0 ? (
          <div role="alert" className="space-y-2 text-[0.8125rem]"><p>{load.error}</p><EButton size="sm" variant="outline" onClick={() => void reload()}>Try again</EButton></div>
        ) : themes.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Create a theme to customise how reports look. Reports still use the built-in Estate layout.</p>
        ) : (
          <>
            <ul className="space-y-2">{active.map(themeCard)}</ul>
            {off.length > 0 ? (
              <>
                <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">Switched off</h3>
                <ul className="space-y-2">{off.map(themeCard)}</ul>
              </>
            ) : null}
          </>
        )}
        <div className={cn("rounded-[var(--e-radius-lg)] px-3 py-2.5 text-[0.8125rem]", toneNoticeClass("info"))}>
          <p className="font-[600]">No per-client theme today</p>
          <p>New reports use the default. Regenerate in <Link href="/v2/admin/reports?tab=pdfs" className="underline">Client report PDFs</Link> can pick another theme for one report or a selection.</p>
        </div>
      </section>

      <section aria-labelledby="theme-editor-heading" className="min-w-0" data-unsaved={dirty && canWrite ? "true" : undefined}>
        {selected && draft ? (
          <ECard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="theme-editor-heading" className="text-[0.9375rem] font-[600]">{canWrite ? "Edit" : "View"} {selected.name}</h2>
              <div className="flex items-center gap-2">
                {selected.isDefault ? <EPill tone="ok">Default</EPill> : !selected.isActive ? <EPill>Switched off</EPill> : null}
                {canWrite ? (
                  <ERowMenu
                    label={`More actions for ${selected.name}`}
                    items={[
                      ...(!selected.isDefault ? [{ key: "default", label: "Make default…", onSelect: () => { setConfirmError(null); setConfirm({ kind: "default", theme: selected }); } }] : []),
                      ...(selected.isActive && !selected.isDefault ? [{ key: "off", label: "Switch off…", separated: true, onSelect: () => { setConfirmError(null); setConfirm({ kind: "off", theme: selected }); } }] : []),
                      ...(!selected.isActive ? [{ key: "on", label: "Switch on", onSelect: () => void switchOn(selected) }] : []),
                      ...(selected.isDefault ? [{ key: "note", label: "The default cannot be switched off", disabled: true, hint: "Make another theme the default first" }] : []),
                    ]}
                  />
                ) : null}
              </div>
            </div>

            <fieldset disabled={locked} className="mt-3 min-w-0 space-y-4">
              <legend className="sr-only">{canWrite ? "Theme settings" : "Theme settings (read only)"}</legend>
              <EField label="Name"><EInput value={draft.name} onChange={(event) => patch({ name: event.target.value })} className="max-sm:h-11 max-sm:text-base" /></EField>

              <div className="space-y-3">
                <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">Look</h3>
                <Segmented label="Template style" options={STYLES} value={styleOf(draft)} onChange={(value) => patchLayout({ template: value })} disabled={locked} />
                <Segmented label="Photo size" options={PHOTO_SIZES} value={draft.layout.photoSize} onChange={(value) => patchLayout({ photoSize: value })} disabled={locked} />
                <Segmented label="Density" options={DENSITIES} value={draft.layout.density} onChange={(value) => patchLayout({ density: value })} disabled={locked} />
              </div>

              <div className="space-y-3">
                <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">Brand</h3>
                <EField label="Logo" hint={draft.logoUrl ? "This theme's own logo." : "Empty: the company logo from Settings is used."}>
                  <EInput value={draft.logoUrl ?? ""} onChange={(event) => patch({ logoUrl: event.target.value || null })} placeholder="Company logo (Settings)" className="max-sm:h-11 max-sm:text-base" />
                </EField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ColourField label="Main colour" value={draft.primaryColorHsl} onChange={(value) => patch({ primaryColorHsl: value })} disabled={locked} />
                  <ColourField label="Accent colour" value={draft.accentColorHsl} onChange={(value) => patch({ accentColorHsl: value })} disabled={locked} />
                </div>
                <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  {contrast === null ? (
                    <>No main colour set: the report uses its own.</>
                  ) : contrast >= READABLE_CONTRAST ? (
                    <><EPill tone="ok">Readable</EPill> White text on the main colour {contrast} : 1; the accent is used for lines only, never for text.</>
                  ) : (
                    <><EPill tone="bad">Hard to read</EPill> White text on this colour is hard to read ({contrast} : 1). Save still works.</>
                  )}
                </p>
                {canWrite ? (
                  <button type="button" className="text-[0.75rem] font-[550] text-[hsl(var(--e-primary))] underline" onClick={() => patch({ primaryColorHsl: ESTATE_REPORT_COLOURS.primary.hsl, accentColorHsl: ESTATE_REPORT_COLOURS.accent.hsl })}>
                    Use Estate green and gold
                  </button>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="theme-title" className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Title</label>
                <EInput id="theme-title" ref={titleRef} value={draft.titleTemplate ?? ""} onChange={(event) => patch({ titleTemplate: event.target.value })} aria-describedby="theme-title-help" className="max-sm:h-11 max-sm:text-base" />
                <div id="theme-title-help" className="flex flex-wrap items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  {TITLE_VARIABLES.map((token) => (
                    <button key={token} type="button" disabled={locked} onMouseDown={(event) => event.preventDefault()} onClick={() => insertTitleVariable(token)} className="min-h-8 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-info)/0.35)] bg-[hsl(var(--e-info-soft))] px-2 font-mono text-[hsl(var(--e-info))] max-sm:min-h-11">
                      {token}
                    </button>
                  ))}
                  <span>the three the generator fills</span>
                </div>
                {badTitle.length > 0 ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">The generator does not fill {badTitle.join(", ")}; it would print as typed. Saving is refused until it is removed.</p> : null}
              </div>

              <EField label="Footer" hint="Plain text and links; stored as the theme's footer. Web addresses and emails become links.">
                <textarea value={draft.footerHtml ?? ""} onChange={(event) => patch({ footerHtml: event.target.value })} rows={2} className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.875rem] max-sm:text-base" />
              </EField>

              <div className="space-y-2">
                <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">Sections, in report order</h3>
                <ul className="divide-y divide-[hsl(var(--e-border))]">
                  {draft.layout.sections.map((section, index) => {
                    const label = SECTION_LABEL[section.id] ?? section.id;
                    return (
                      <li key={section.id} className="flex items-center gap-2 py-1.5">
                        <span className="flex">
                          <EButton type="button" variant="ghost" size="icon" aria-label={`Move ${label} up`} disabled={locked || index === 0} onClick={() => moveSection(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></EButton>
                          <EButton type="button" variant="ghost" size="icon" aria-label={`Move ${label} down`} disabled={locked || index === draft.layout.sections.length - 1} onClick={() => moveSection(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></EButton>
                        </span>
                        <span className={cn("min-w-0 flex-1 text-[0.875rem]", !section.visible && "text-[hsl(var(--e-text-secondary))]")}>{label}{section.visible ? "" : " · off"}</span>
                        <ESwitch checked={section.visible} disabled={locked} onCheckedChange={(visible) => patchLayout({ sections: draft.layout.sections.map((row) => (row.id === section.id ? { ...row, visible } : row)) })} label={<span className="sr-only">Show {label}</span>} />
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">On and off change the report. The order is saved with the theme; the generator still draws the sections in its own fixed order.</p>
              </div>
            </fieldset>

            {error ? (
              <div role="alert" className={cn("mt-3 rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem]", toneNoticeClass("problem"))}>
                <p>{error}</p>
                {conflict ? <EButton size="sm" variant="outline" className="mt-2" onClick={() => { setThemes((current) => current.map((theme) => (theme.id === conflict.id ? { ...conflict, _count: theme._count } : theme))); setDraft(draftOf(conflict)); setConflict(null); setError(null); }}>Load their version</EButton> : null}
              </div>
            ) : null}
            {status ? <p role="status" className="mt-3 text-[0.8125rem] text-[hsl(var(--e-success))]">{status}</p> : null}

            {canWrite ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--e-border))] pt-3">
                <p className="min-w-0 flex-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Saving changes future reports only. Sent PDFs keep their look until regenerated.</p>
                <div className="flex gap-2 max-sm:w-full">
                  <EButton variant="outline" disabled={saving || !dirty} onClick={() => { setDraft(draftOf(selected)); setError(null); }} className="max-sm:flex-1">Discard</EButton>
                  <EButton disabled={saving || !dirty || badTitle.length > 0} onClick={() => void save()} className="max-sm:flex-1">{saving ? "Saving…" : "Save theme"}</EButton>
                </div>
              </div>
            ) : (
              <p className="mt-4 border-t border-[hsl(var(--e-border))] pt-3 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Read only: your account can see themes and the preview, not change them.</p>
            )}
          </ECard>
        ) : load.status === "ready" && themes.length === 0 ? null : (
          <ECard className="p-6 text-[0.875rem] text-[hsl(var(--e-text-secondary))]"><h2 id="theme-editor-heading" className="sr-only">Theme editor</h2>Choose a theme to edit it.</ECard>
        )}
      </section>

      <section aria-labelledby="theme-preview-heading" className="min-w-0 space-y-2 lg:col-span-2 xl:col-span-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="theme-preview-heading" className="text-[0.9375rem] font-[600]">Preview</h2>
          <ESelect aria-label="Job for the preview" value={jobId} onChange={(event) => setJobId(event.target.value)} disabled={jobs.status !== "ready" || jobs.rows.length === 0} className="h-9 w-auto max-w-[16rem] max-sm:h-11">
            {jobs.status === "loading" ? <option value="">Loading jobs…</option> : null}
            {jobs.status === "failed" ? <option value="">Recent jobs could not load</option> : null}
            {jobs.status === "ready" && jobs.rows.length === 0 ? <option value="">No job with a submitted form yet</option> : null}
            {jobs.rows.map((job) => <option key={job.id} value={job.id}>{jobLabel(job)}</option>)}
          </ESelect>
        </div>
        <div className="relative overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-white" style={{ height: "36rem" }}>
          {preview.status === "ready" && preview.html ? (
            <iframe title={`Report preview${chosenJob ? `, ${jobLabel(chosenJob)}` : ""}`} sandbox="" srcDoc={preview.html} className="h-full w-full" />
          ) : null}
          {preview.status === "loading" ? <p role="status" className="absolute left-3 top-3 rounded bg-white/90 px-2 py-1 text-[0.75rem] text-neutral-700">Rendering the preview…</p> : null}
          {preview.status === "failed" ? (
            <p role="alert" className="p-4 text-[0.8125rem] text-neutral-800">The preview could not be made for {chosenJob ? jobLabel(chosenJob) : "this job"}. Choose another job. The editor keeps your changes.</p>
          ) : null}
          {preview.status === "idle" ? <p className="p-4 text-[0.8125rem] text-neutral-700">{jobs.status === "ready" && jobs.rows.length === 0 ? "A preview needs a job with a submitted form." : "Choose a theme and a job to preview."}</p> : null}
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Rendered by the same generator that makes the PDF, from a recent job you choose. Nothing is sent or saved.</p>
        <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          Emails have their own look: <Link href="/v2/admin/notifications/email-look" className="font-[550] text-[hsl(var(--e-primary))] underline">Notifications › Email look</Link>. Both start from Estate green and gold.
        </p>
      </section>

      <EConfirmDialog
        open={pendingTheme !== null}
        onClose={() => setPendingTheme(null)}
        tier="ordinary"
        title="Leave this theme without saving your changes?"
        description="Your changes to this theme are not saved. Leaving drops them."
        confirmLabel="Leave without saving"
        onConfirm={() => {
          if (pendingTheme) open(pendingTheme);
          setPendingTheme(null);
        }}
      />
      <EConfirmDialog
        open={confirm !== null}
        onClose={() => { if (!confirmBusy) setConfirm(null); }}
        tier="ordinary"
        title={confirm?.kind === "default" ? `Make ${confirm.theme.name} the default?` : `Switch off ${confirm?.theme.name ?? "this theme"}?`}
        description={
          confirm?.kind === "default"
            ? "New reports use it from now on. Reports already made keep their look until someone regenerates them."
            : `It leaves the picker. ${confirm?.theme._count?.reports ? `The ${confirm.theme._count.reports} report${confirm.theme._count.reports === 1 ? "" : "s"} made with it keep it` : "Reports made with it keep it"}, and you can switch it on again. The default cannot be switched off.`
        }
        confirmLabel={confirm?.kind === "default" ? "Make default" : "Switch off"}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => runConfirm()}
      />
    </div>
  );
}
