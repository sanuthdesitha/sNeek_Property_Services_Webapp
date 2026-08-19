"use client";

/**
 * ESTATE report-theme manager — v2 port of the legacy /admin/reports/themes
 * surface (list, create, set default) plus the theme editor
 * (components/reports/theme-editor.tsx): identity fields, template style,
 * photo size, density, and section order/visibility. Same endpoints as v1
 * (/api/admin/report-themes[...]) — no new API routes; only the UI is new.
 * The editor lives in an EModal rather than a nested /[id]/edit route so the
 * whole surface stays on one page (matches how reports-manager handles
 * sub-flows) and stays mobile-safe.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Palette, Pencil, Plus, Star } from "lucide-react";
import { EBadge, EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESwitch } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";

type ThemeSection = {
  id: string;
  visible: boolean;
  order: number;
  options?: Record<string, unknown>;
};

type ThemeLayout = {
  sections: ThemeSection[];
  photoSize: "small" | "medium" | "large" | "hero";
  density: "compact" | "default" | "comfortable";
  template?: "classic" | "luxury" | "estate";
};

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
};

// Same labels the v1 editor used, so section ids read as human names.
const SECTION_LABELS: Record<string, string> = {
  header: "Header (logo + title)",
  summary: "Job summary",
  "task-checklist": "Task checklist + admin tasks",
  "qa-summary": "Quality inspection summary",
  "before-after-gallery": "Photo gallery",
  supplies: "Supplies / inventory",
  signature: "Signature block",
  footer: "Footer",
};

const PHOTO_SIZES: Array<ThemeLayout["photoSize"]> = ["small", "medium", "large", "hero"];
const DENSITIES: Array<ThemeLayout["density"]> = ["compact", "default", "comfortable"];
const TEMPLATE_STYLES: Array<NonNullable<ThemeLayout["template"]>> = ["estate", "classic", "luxury"];

// Fallback shape mirroring the v1 edit page's server-side normalisation —
// old rows may have a null/legacy layout JSON, and the editor needs the
// standard shape to render toggles.
const DEFAULT_LAYOUT: ThemeLayout = {
  sections: [
    { id: "header", visible: true, order: 0 },
    { id: "summary", visible: true, order: 1 },
    { id: "task-checklist", visible: true, order: 2 },
    { id: "before-after-gallery", visible: true, order: 3 },
    { id: "supplies", visible: false, order: 4 },
    { id: "signature", visible: true, order: 5 },
    { id: "footer", visible: true, order: 6 },
  ],
  photoSize: "medium",
  density: "default",
};

function normalizeTheme(raw: any): ReportTheme {
  const layout: ThemeLayout =
    raw?.layout && typeof raw.layout === "object" && Array.isArray(raw.layout.sections)
      ? raw.layout
      : DEFAULT_LAYOUT;
  return {
    ...raw,
    layout: {
      ...layout,
      // Keep sections display-order stable regardless of stored array order.
      sections: [...layout.sections].sort((a, b) => a.order - b.order),
    },
  };
}

const CHIP_LABEL =
  "text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]";

/** Chip row used for template / photo size / density single-choice pickers. */
function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className={CHIP_LABEL}>{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <EButton
            key={option}
            type="button"
            size="sm"
            variant={value === option ? "primary" : "outline"}
            className="capitalize"
            onClick={() => onChange(option)}
          >
            {option}
          </EButton>
        ))}
      </div>
    </div>
  );
}

export function ThemeManager() {
  const [themes, setThemes] = useState<ReportTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReportTheme | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/report-themes");
    const data = await res.json().catch(() => ({}));
    setThemes(Array.isArray(data?.themes) ? data.themes.map(normalizeTheme) : []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createTheme() {
    setBusyId("__new__");
    const res = await fetch("/api/admin/report-themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New theme" }),
    });
    const body = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok || !body.theme) {
      toast({ title: "Could not create theme", description: body.error ?? "Try again", variant: "destructive" });
      return;
    }
    toast({ title: "Theme created" });
    // Open the editor straight away (v1 navigated to /themes/[id]/edit).
    setEditing(normalizeTheme(body.theme));
    void load();
  }

  async function setDefault(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/admin/report-themes/${id}/set-default`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Could not set default", description: body.error ?? "Try again", variant: "destructive" });
      return;
    }
    toast({ title: "Default theme updated" });
    // Reflect immediately in the open editor too, then re-sync the list.
    setEditing((prev) => (prev && prev.id === id ? { ...prev, isDefault: true } : prev));
    void load();
  }

  function updateEditing(patch: Partial<ReportTheme>) {
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function updateLayout(patch: Partial<ThemeLayout>) {
    setEditing((prev) => (prev ? { ...prev, layout: { ...prev.layout, ...patch } } : prev));
  }

  function toggleSection(id: string, visible: boolean) {
    if (!editing) return;
    updateLayout({
      sections: editing.layout.sections.map((section) =>
        section.id === id ? { ...section, visible } : section
      ),
    });
  }

  /**
   * Reorder by swapping array neighbours, then rewrite `order` from the new
   * index — the renderer sorts by `order`, so indices must stay contiguous.
   */
  function moveSection(id: string, direction: -1 | 1) {
    if (!editing) return;
    const sections = editing.layout.sections;
    const index = sections.findIndex((section) => section.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sections.length) return;
    const reordered = [...sections];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    updateLayout({
      sections: reordered.map((section, order) => ({ ...section, order })),
    });
  }

  async function saveEditing() {
    if (!editing) return;
    setSaving(true);
    const res = await fetch(`/api/admin/report-themes/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Same payload shape the v1 editor sent — the route ignores extras.
      body: JSON.stringify({
        name: editing.name,
        layout: editing.layout,
        logoUrl: editing.logoUrl,
        primaryColorHsl: editing.primaryColorHsl,
        accentColorHsl: editing.accentColorHsl,
        titleTemplate: editing.titleTemplate,
        footerHtml: editing.footerHtml,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Save failed", description: body.error ?? "Try again", variant: "destructive" });
      return;
    }
    toast({ title: "Theme saved" });
    void load();
  }

  return (
    <div className="space-y-5">
      {/* List + create */}
      <ECard>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-5 py-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Themes control report layout, photo size, and branding.
          </p>
          <EButton size="sm" onClick={() => void createTheme()} disabled={busyId === "__new__"}>
            <Plus className="h-3.5 w-3.5" />
            {busyId === "__new__" ? "Creating…" : "New theme"}
          </EButton>
        </div>
        {loading ? (
          <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Loading themes…
          </p>
        ) : themes.length === 0 ? (
          <EEmptyState
            eyebrow="Themes"
            title="No themes yet"
            description="Create a theme to customise how generated reports look."
            className="border-0"
          />
        ) : (
          <div>
            {themes.map((theme) => (
              <div
                key={theme.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-5 py-4 last:border-0 hover:bg-[hsl(var(--e-muted))]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                    <Palette className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[0.875rem] font-[550]">
                      <span className="truncate">{theme.name}</span>
                      {theme.isDefault ? <EBadge tone="gold" soft>Default</EBadge> : null}
                    </p>
                    <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {theme.kind} · updated {new Date(theme.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {!theme.isDefault ? (
                    <EButton
                      variant="ghost"
                      size="sm"
                      disabled={busyId === theme.id}
                      onClick={() => void setDefault(theme.id)}
                    >
                      <Star className="h-3.5 w-3.5" />
                      {busyId === theme.id ? "Setting…" : "Set default"}
                    </EButton>
                  ) : null}
                  <EButton variant="outline" size="sm" onClick={() => setEditing(theme)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </EButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </ECard>

      {/* Editor */}
      <EModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        eyebrow="Report theme"
        title={editing?.name || "Edit theme"}
        size="xl"
      >
        {editing ? (
          <div className="space-y-6">
            {/* Identity + branding (parity with the v1 editor's first card) */}
            <div className="grid gap-4 sm:grid-cols-2">
              <EField label="Name">
                <EInput
                  value={editing.name}
                  onChange={(event) => updateEditing({ name: event.target.value })}
                />
              </EField>
              <EField
                label="Title template"
                hint={`Supports {{job.jobNumber}} and {{property.name}}.`}
              >
                <EInput
                  value={editing.titleTemplate ?? ""}
                  onChange={(event) => updateEditing({ titleTemplate: event.target.value })}
                  placeholder="Job Report — {{job.jobNumber}}"
                />
              </EField>
              <EField label="Logo URL" className="sm:col-span-2">
                <EInput
                  value={editing.logoUrl ?? ""}
                  onChange={(event) => updateEditing({ logoUrl: event.target.value })}
                  placeholder="https://..."
                />
              </EField>
              <EField label="Primary color (HSL)">
                <EInput
                  value={editing.primaryColorHsl ?? ""}
                  onChange={(event) => updateEditing({ primaryColorHsl: event.target.value })}
                  placeholder="200 98% 39%"
                />
              </EField>
              <EField label="Accent color (HSL)">
                <EInput
                  value={editing.accentColorHsl ?? ""}
                  onChange={(event) => updateEditing({ accentColorHsl: event.target.value })}
                  placeholder="188 78% 30%"
                />
              </EField>
            </div>

            {/* Layout options */}
            <div className="space-y-4 border-t border-[hsl(var(--e-border))] pt-5">
              <ChipRow
                label="Template style"
                options={TEMPLATE_STYLES}
                value={editing.layout.template ?? "classic"}
                onChange={(template) => updateLayout({ template })}
              />
              <ChipRow
                label="Photo size"
                options={PHOTO_SIZES}
                value={editing.layout.photoSize}
                onChange={(photoSize) => updateLayout({ photoSize })}
              />
              <ChipRow
                label="Density"
                options={DENSITIES}
                value={editing.layout.density}
                onChange={(density) => updateLayout({ density })}
              />
            </div>

            {/* Sections: order + visibility */}
            <div className="space-y-2 border-t border-[hsl(var(--e-border))] pt-5">
              <p className={CHIP_LABEL}>Sections</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                Toggle visibility and reorder how sections appear in the rendered report.
              </p>
              <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                {editing.layout.sections.map((section, index) => (
                  <div
                    key={section.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-3 py-2 last:border-0"
                  >
                    <ESwitch
                      checked={section.visible}
                      onCheckedChange={(visible) => toggleSection(section.id, visible)}
                      label={SECTION_LABELS[section.id] ?? section.id}
                    />
                    <span className="flex items-center gap-1">
                      <EButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        aria-label="Move section up"
                        disabled={index === 0}
                        onClick={() => moveSection(section.id, -1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </EButton>
                      <EButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        aria-label="Move section down"
                        disabled={index === editing.layout.sections.length - 1}
                        onClick={() => moveSection(section.id, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </EButton>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer actions (parity with the v1 editor footer) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-5">
              <div>
                {editing.isDefault ? (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    This is the default theme.
                  </p>
                ) : (
                  <EButton
                    variant="outline"
                    size="sm"
                    disabled={busyId === editing.id}
                    onClick={() => void setDefault(editing.id)}
                  >
                    <Star className="h-3.5 w-3.5" />
                    {busyId === editing.id ? "Setting…" : "Set as default"}
                  </EButton>
                )}
              </div>
              <div className="flex items-center gap-2">
                <EButton variant="outline" size="sm" onClick={() => setEditing(null)} disabled={saving}>
                  Close
                </EButton>
                <EButton size="sm" onClick={() => void saveEditing()} disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </EButton>
              </div>
            </div>
          </div>
        ) : null}
      </EModal>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Themes are applied when a report is regenerated from{" "}
        <Link href="/v2/admin/reports" className="underline hover:text-[hsl(var(--e-foreground))]">
          Reports
        </Link>
        .
      </p>
    </div>
  );
}
