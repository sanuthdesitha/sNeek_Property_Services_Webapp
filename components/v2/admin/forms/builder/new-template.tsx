"use client";

/**
 * ESTATE v2 form builder — new-template creator. Blank template (name + kind)
 * or start from a shared seed template. POSTs to /api/admin/form-templates
 * (V1 kind-path: creates a draft with the next version) then redirects into
 * the Estate builder at /v2/admin/forms/[id]/edit. Native Estate styling.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, LayoutTemplate, Sparkles } from "lucide-react";
import { ALL_SEED_TEMPLATES } from "@/lib/forms/seed-templates";
import { EButton, ECard, ECardBody, EEyebrow, EPageHeader, EBadge } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";

/** [FormKind, label, default JobType serviceType] — mirrors the v1 new page. */
const KINDS: ReadonlyArray<readonly [string, string, string]> = [
  ["AIRBNB_TURNOVER", "Airbnb Turnover", "AIRBNB_TURNOVER"],
  ["END_OF_LEASE", "End of Lease", "END_OF_LEASE"],
  ["DEEP_CLEAN", "Deep Clean", "DEEP_CLEAN"],
  ["REGULAR_MAINTENANCE", "Regular Maintenance", "GENERAL_CLEAN"],
  ["POST_CONSTRUCTION", "Post-Construction", "POST_CONSTRUCTION"],
  ["WINDOW", "Window / Glass", "WINDOW_CLEAN"],
  ["CARPET", "Carpet / Steam", "CARPET_STEAM_CLEAN"],
  ["COMMERCIAL", "Commercial / Office", "COMMERCIAL_RECURRING"],
  ["MOVE_IN", "Move-in / Move-out", "GENERAL_CLEAN"],
  ["OVEN", "Oven / Appliance", "SPECIAL_CLEAN"],
  ["CUSTOM", "Custom", "GENERAL_CLEAN"],
];

type SeedTemplate = (typeof ALL_SEED_TEMPLATES)[number];
const sectionCount = (t: SeedTemplate) => t.schema.sections.length;
const fieldCount = (t: SeedTemplate) => t.schema.sections.reduce((sum, s) => sum + s.fields.length, 0);

export function NewTemplate() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState("CUSTOM");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function createTemplate(payload: { name: string; kind: string; serviceType: string; schema?: unknown }) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/form-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Create failed (${res.status})`);
      }
      const body = await res.json();
      const id = body?.id ?? body?.template?.id;
      if (!id) throw new Error("Server returned no template id");
      router.push(`/v2/admin/forms/${id}/edit`);
    } catch (err: any) {
      setError(err?.message ?? "Create failed");
      setSaving(false);
    }
  }

  function createBlank() {
    const serviceType = KINDS.find((k) => k[0] === kind)?.[2] ?? "GENERAL_CLEAN";
    void createTemplate({ name: name.trim() || "Untitled template", kind, serviceType });
  }
  function startFromTemplate(t: SeedTemplate) {
    void createTemplate({
      name: name.trim() || t.name.replace(/\s+v\d+$/i, ""),
      kind: t.kind,
      serviceType: t.serviceType,
      schema: t.schema,
    });
  }

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Forms"
        title="New form template"
        description="Start blank, or clone a ready-made template. Every template opens in the Estate builder to refine sections, fields and appearance."
      />

      <ECard>
        <ECardBody className="space-y-4 pt-6">
          <div className="flex items-center gap-2 text-[hsl(var(--e-gold-ink))]">
            <FileText className="size-4" />
            <p className="text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">Blank template</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Name (optional)">
              <EInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premium turnover" />
            </EField>
            <EField label="Job kind">
              <ESelect value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </ESelect>
            </EField>
          </div>
          {error ? <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          <EButton variant="outline" onClick={createBlank} disabled={saving}>
            {saving ? "Creating…" : "Create blank template"}
          </EButton>
        </ECardBody>
      </ECard>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="size-4 text-[hsl(var(--e-text-faint))]" />
          <EEyebrow>Start from a ready-made template</EEyebrow>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_SEED_TEMPLATES.map((t) => {
            const accent = t.schema.theme?.accentColor;
            return (
              <ECard key={`${t.kind}-${t.version}`} className="flex flex-col">
                <ECardBody className="flex flex-1 flex-col gap-2 pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[0.9375rem] font-semibold leading-snug text-[hsl(var(--e-foreground))]">
                      {t.name.replace(/\s+v\d+$/i, "")}
                    </p>
                    <span
                      className="mt-0.5 size-4 shrink-0 rounded-full border border-[hsl(var(--e-border-strong))]"
                      style={accent ? { backgroundColor: accent } : undefined}
                      aria-hidden
                    />
                  </div>
                  <p className="flex-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    {t.serviceType.replace(/_/g, " ")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <EBadge tone="neutral" soft>
                      {sectionCount(t)} sections
                    </EBadge>
                    <EBadge tone="neutral" soft>
                      {fieldCount(t)} fields
                    </EBadge>
                  </div>
                  <EButton size="sm" className="mt-1 w-full" disabled={saving} onClick={() => startFromTemplate(t)}>
                    <Sparkles className="size-4" /> Use this template
                  </EButton>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      </div>
    </div>
  );
}
