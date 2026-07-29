"use client";

/**
 * ESTATE v2 — "new form" launcher. Four ways to start, all of which end in the
 * builder at /v2/admin/forms/[id]/edit:
 *
 *   1. Blank            → POST /api/admin/form-templates { name, kind, serviceType }
 *   2. Starter blueprint→ …the same POST with the blueprint's `schema` pre-filled
 *                         (lib/forms/starter-templates.ts)
 *   3. Existing form    → POST /api/admin/form-templates/[id]/duplicate
 *   4. Shared seed      → the older seed library (lib/forms/seed-templates)
 *
 * Everything created here is a DRAFT: the create + duplicate endpoints both
 * start templates inactive so publishing stays a deliberate step. That is also
 * why the "existing form" list is fetched with `includeDrafts=1` — the default
 * list filter hides drafts.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, FileText, LayoutTemplate, Loader2, Sparkles } from "lucide-react";
import { STARTER_TEMPLATES, starterTemplateStats, type StarterTemplate } from "@/lib/forms/starter-templates";
import { ALL_SEED_TEMPLATES } from "@/lib/forms/seed-templates";
import { EButton, ECard, ECardBody, EEyebrow, EPageHeader, EBadge, EAlert } from "@/components/v2/ui/primitives";
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

const prettyType = (value: string) => value.replace(/_/g, " ");

interface ExistingTemplate {
  id: string;
  name: string;
  serviceType: string;
  version: number;
  isActive: boolean;
}

type SeedTemplate = (typeof ALL_SEED_TEMPLATES)[number];

export function NewFormLauncher() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState("CUSTOM");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [existing, setExisting] = React.useState<ExistingTemplate[]>([]);
  const [existingError, setExistingError] = React.useState<string | null>(null);
  const [sourceId, setSourceId] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/form-templates?includeDrafts=1", { cache: "no-store" });
        const body = await res.json().catch(() => []);
        if (!res.ok) throw new Error((body as any)?.error ?? "Could not load your forms.");
        if (cancelled) return;
        const rows = (Array.isArray(body) ? body : []) as ExistingTemplate[];
        setExisting([...rows].sort((a, b) => a.name.localeCompare(b.name)));
        setSourceId(rows.length ? rows[0].id : "");
      } catch (err: any) {
        if (!cancelled) setExistingError(err?.message ?? "Could not load your forms.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** POST a create/duplicate call and hand the owner straight to the builder. */
  async function createAndOpen(
    key: string,
    request: () => Promise<Response>
  ) {
    setError(null);
    setBusy(key);
    try {
      const res = await request();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Create failed (${res.status})`);
      const id = body?.id ?? body?.template?.id;
      if (!id) throw new Error("Server returned no template id");
      router.push(`/v2/admin/forms/${id}/edit`);
    } catch (err: any) {
      setError(err?.message ?? "Create failed");
      setBusy(null);
    }
  }

  const postTemplate = (payload: { name: string; kind: string; serviceType: string; schema?: unknown }) =>
    fetch("/api/admin/form-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  function createBlank() {
    const serviceType = KINDS.find((k) => k[0] === kind)?.[2] ?? "GENERAL_CLEAN";
    void createAndOpen("blank", () =>
      postTemplate({ name: name.trim() || "Untitled template", kind, serviceType })
    );
  }

  function startFromStarter(starter: StarterTemplate) {
    void createAndOpen(`starter:${starter.id}`, () =>
      postTemplate({
        name: name.trim() || starter.name,
        kind: starter.kind,
        serviceType: starter.serviceType,
        schema: starter.schema,
      })
    );
  }

  function startFromSeed(seed: SeedTemplate) {
    void createAndOpen(`seed:${seed.kind}-${seed.version}`, () =>
      postTemplate({
        name: name.trim() || seed.name.replace(/\s+v\d+$/i, ""),
        kind: seed.kind,
        serviceType: seed.serviceType,
        schema: seed.schema,
      })
    );
  }

  function startFromExisting() {
    if (!sourceId) return;
    void createAndOpen("duplicate", () =>
      fetch(`/api/admin/form-templates/${sourceId}/duplicate`, { method: "POST" })
    );
  }

  const isBusy = busy !== null;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Forms"
        title="New form template"
        description="Start from a blueprint built for this business, copy a form you already run, or begin blank. Everything opens in the Estate builder as a draft — nothing goes live until you publish it."
      />

      {error ? (
        <EAlert tone="danger" title="Could not create the template">
          {error}
        </EAlert>
      ) : null}

      <ECard>
        <ECardBody className="space-y-4 pt-6">
          <div className="flex items-center gap-2 text-[hsl(var(--e-gold-ink))]">
            <FileText className="size-4" />
            <p className="text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">Blank template</p>
          </div>
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            The name is optional — it also applies to any blueprint you pick below.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Name (optional)">
              <EInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premium turnover" />
            </EField>
            <EField label="Job kind">
              <ESelect value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </ESelect>
            </EField>
          </div>
          <EButton variant="outline" onClick={createBlank} disabled={isBusy}>
            {busy === "blank" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {busy === "blank" ? "Creating…" : "Start blank"}
          </EButton>
        </ECardBody>
      </ECard>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="size-4 text-[hsl(var(--e-text-faint))]" />
          <EEyebrow>Start from a blueprint</EEyebrow>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STARTER_TEMPLATES.map((starter) => {
            const stats = starterTemplateStats(starter);
            const key = `starter:${starter.id}`;
            return (
              <ECard key={starter.id} className="flex flex-col">
                <ECardBody className="flex flex-1 flex-col gap-2 pt-6">
                  <p className="text-[0.9375rem] font-semibold leading-snug text-[hsl(var(--e-foreground))]">
                    {starter.name}
                  </p>
                  <p className="text-[0.6875rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                    {prettyType(starter.serviceType)}
                  </p>
                  <p className="flex-1 text-[0.75rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
                    {starter.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <EBadge tone="neutral" soft>
                      {stats.sections} sections
                    </EBadge>
                    <EBadge tone="neutral" soft>
                      {stats.fields} fields
                    </EBadge>
                    <EBadge tone="info" soft>
                      {stats.photoFields} photo
                    </EBadge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {starter.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-2 py-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <EButton
                    size="sm"
                    className="mt-1 w-full"
                    disabled={isBusy}
                    onClick={() => startFromStarter(starter)}
                  >
                    {busy === key ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 size-4" />
                    )}
                    {busy === key ? "Creating…" : "Use this blueprint"}
                  </EButton>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      </div>

      <ECard>
        <ECardBody className="space-y-4 pt-6">
          <div className="flex items-center gap-2 text-[hsl(var(--e-gold-ink))]">
            <Copy className="size-4" />
            <p className="text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">
              Start from a form you already run
            </p>
          </div>
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            Copies the whole schema into a new draft and leaves the original untouched.
          </p>
          {existingError ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{existingError}</p>
          ) : existing.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
              No forms to copy yet — start from a blueprint above.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <EField label="Form to copy">
                <ESelect value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                  {existing.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {prettyType(t.serviceType)} · v{t.version}
                      {t.isActive ? "" : " (draft)"}
                    </option>
                  ))}
                </ESelect>
              </EField>
              <EButton variant="outline" onClick={startFromExisting} disabled={isBusy || !sourceId}>
                {busy === "duplicate" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
                {busy === "duplicate" ? "Copying…" : "Copy into a new draft"}
              </EButton>
            </div>
          )}
        </ECardBody>
      </ECard>

      <details className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
        <summary className="cursor-pointer text-[0.8125rem] font-semibold text-[hsl(var(--e-foreground))]">
          More ready-made templates ({ALL_SEED_TEMPLATES.length})
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_SEED_TEMPLATES.map((seed) => {
            const key = `seed:${seed.kind}-${seed.version}`;
            const sections = seed.schema.sections.length;
            const fields = seed.schema.sections.reduce((sum, s) => sum + s.fields.length, 0);
            return (
              <ECard key={key} className="flex flex-col">
                <ECardBody className="flex flex-1 flex-col gap-2 pt-6">
                  <p className="text-[0.9375rem] font-semibold leading-snug text-[hsl(var(--e-foreground))]">
                    {seed.name.replace(/\s+v\d+$/i, "")}
                  </p>
                  <p className="flex-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    {prettyType(seed.serviceType)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <EBadge tone="neutral" soft>
                      {sections} sections
                    </EBadge>
                    <EBadge tone="neutral" soft>
                      {fields} fields
                    </EBadge>
                  </div>
                  <EButton
                    size="sm"
                    variant="outline"
                    className="mt-1 w-full"
                    disabled={isBusy}
                    onClick={() => startFromSeed(seed)}
                  >
                    {busy === key ? "Creating…" : "Use this template"}
                  </EButton>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      </details>
    </div>
  );
}
