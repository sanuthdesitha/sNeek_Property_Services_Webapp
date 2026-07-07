"use client";

/**
 * ESTATE per-property checklist profile + form defaults — v2-native port of
 * the v1 PropertyChecklistBuilder + "Property Form Defaults" card (Forms tab
 * of app/admin/properties/[id]). Same endpoints:
 *   GET  /api/admin/properties/:id/checklist-profile           → editor state
 *   PUT  /api/admin/properties/:id/checklist-profile           { selections, features? }
 *   POST /api/admin/properties/:id/checklist-profile           { jobTypes[] } (approve → generate forms)
 *   POST /api/admin/properties/:id/checklist-profile/preview   { selections, jobType }
 *   GET/PATCH /api/admin/properties/:id/form-overrides         per-job-type template defaults
 * Estate token scope only; no components/ui/* dependency.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";

type JobTypeValue = string;

interface FeatureDef {
  key: string;
  label: string;
  group: string;
}

interface LibraryItem {
  id: string;
  key: string;
  label: string;
  instructions: string | null;
  fieldType: string;
  jobTypes: JobTypeValue[];
  appliesWhen: unknown;
}

interface LibraryModule {
  id: string;
  key: string;
  title: string;
  category: string;
  items: LibraryItem[];
}

interface ItemSelection {
  enabled: boolean;
  jobTypes?: JobTypeValue[];
}

interface ModuleSelection {
  enabled: boolean;
  items: Record<string, ItemSelection>;
}

interface CustomItem {
  id: string;
  moduleKey?: string;
  label: string;
  instructions?: string;
  jobTypes?: JobTypeValue[];
}

interface Selections {
  modules: Record<string, ModuleSelection>;
  customItems: CustomItem[];
}

interface PreviewField {
  id: string;
  label: string;
  type: string;
  instructions?: string;
}

interface PreviewSection {
  id: string;
  title: string;
  description?: string;
  fields: PreviewField[];
}

interface BuilderData {
  propertyId: string;
  propertyName: string;
  features: Record<string, boolean>;
  featureDefs: FeatureDef[];
  jobTypes: JobTypeValue[];
  library: LibraryModule[];
  selections: Selections;
  profile: { status: string; approvedAt: string | null; generatedTemplateIds: Record<string, string> } | null;
}

function prettyJobType(jobType: string) {
  return jobType
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const CHECKBOX_CLASS =
  "h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))] rounded border-[hsl(var(--e-border-strong))]";

/* ── Checklist profile builder (amenities → sections → preview → approve) ── */
export function PropertyChecklistProfile({ propertyId }: { propertyId: string }) {
  const apiBase = `/api/admin/properties/${propertyId}/checklist-profile`;
  const [data, setData] = useState<BuilderData | null>(null);
  const [selections, setSelections] = useState<Selections>({ modules: {}, customItems: [] });
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [previewJobType, setPreviewJobType] = useState<JobTypeValue>("AIRBNB_TURNOVER");
  const [preview, setPreview] = useState<{ sections: PreviewSection[] } | null>(null);
  const [approveJobTypes, setApproveJobTypes] = useState<JobTypeValue[]>([]);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemInstructions, setNewItemInstructions] = useState("");
  const [newItemModule, setNewItemModule] = useState<string>("custom");
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiBase, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load checklist.");
      setData(body);
      setSelections(body.selections ?? { modules: {}, customItems: [] });
      setFeatures(body.features ?? {});
      const firstJobTypes: string[] =
        Object.keys(body.profile?.generatedTemplateIds ?? {}).length > 0
          ? Object.keys(body.profile.generatedTemplateIds)
          : ["AIRBNB_TURNOVER"];
      setApproveJobTypes(firstJobTypes.filter((jt) => body.jobTypes.includes(jt)));
      setPreviewJobType(
        firstJobTypes[0] && body.jobTypes.includes(firstJobTypes[0]) ? firstJobTypes[0] : "AIRBNB_TURNOVER",
      );
      setDirty(false);
    } catch (err: any) {
      toast({ title: "Could not load checklist", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced live preview from the SAME server composer approval uses.
  useEffect(() => {
    if (!data) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selections, jobType: previewJobType }),
        });
        const body = await res.json();
        if (res.ok) setPreview(body.schema);
      } catch {
        /* preview is best-effort */
      }
    }, 350);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [data, selections, previewJobType, apiBase]);

  const setModuleEnabled = (moduleKey: string, enabled: boolean) => {
    setSelections((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [moduleKey]: { enabled, items: prev.modules[moduleKey]?.items ?? {} },
      },
    }));
    setDirty(true);
  };

  const setItemEnabled = (moduleKey: string, itemKey: string, enabled: boolean) => {
    setSelections((prev) => {
      const module = prev.modules[moduleKey] ?? { enabled: true, items: {} };
      return {
        ...prev,
        modules: {
          ...prev.modules,
          [moduleKey]: {
            ...module,
            items: { ...module.items, [itemKey]: { ...module.items[itemKey], enabled } },
          },
        },
      };
    });
    setDirty(true);
  };

  const toggleItemJobType = (
    moduleKey: string,
    itemKey: string,
    libraryJobTypes: JobTypeValue[],
    jobType: JobTypeValue,
  ) => {
    setSelections((prev) => {
      const module = prev.modules[moduleKey] ?? { enabled: true, items: {} };
      const current = module.items[itemKey] ?? { enabled: true };
      // Effective job types = explicit override, else library default (empty = all).
      const allJobTypes = data?.jobTypes ?? [];
      const effective = current.jobTypes ?? (libraryJobTypes.length > 0 ? libraryJobTypes : allJobTypes);
      const next = effective.includes(jobType)
        ? effective.filter((jt) => jt !== jobType)
        : [...effective, jobType];
      return {
        ...prev,
        modules: {
          ...prev.modules,
          [moduleKey]: {
            ...module,
            items: { ...module.items, [itemKey]: { ...current, jobTypes: next } },
          },
        },
      };
    });
    setDirty(true);
  };

  const toggleFeature = (key: string) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
    setDirty(true);
  };

  const addCustomItem = () => {
    const label = newItemLabel.trim();
    if (!label) return;
    setSelections((prev) => ({
      ...prev,
      customItems: [
        ...prev.customItems,
        {
          id: `c${Date.now().toString(36)}`,
          moduleKey: newItemModule === "custom" ? undefined : newItemModule,
          label,
          instructions: newItemInstructions.trim() || undefined,
        },
      ],
    }));
    setNewItemLabel("");
    setNewItemInstructions("");
    setDirty(true);
  };

  const removeCustomItem = (id: string) => {
    setSelections((prev) => ({ ...prev, customItems: prev.customItems.filter((c) => c.id !== id) }));
    setDirty(true);
  };

  const save = async (silent = false) => {
    setSaving(true);
    try {
      const res = await fetch(apiBase, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections, features }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      setDirty(false);
      if (!silent) toast({ title: "Checklist draft saved" });
      return true;
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (approveJobTypes.length === 0) {
      toast({ title: "Pick at least one job type to generate the form for.", variant: "destructive" });
      return;
    }
    setApproving(true);
    try {
      const saved = await save(true);
      if (!saved) return;
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobTypes: approveJobTypes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not approve.");
      toast({
        title: "Checklist approved",
        description: `Generated ${Object.keys(body.generated ?? {}).length} property-specific form(s). They are now this property's forms.`,
      });
      await load();
    } catch (err: any) {
      toast({ title: "Approve failed", description: err.message, variant: "destructive" });
    } finally {
      setApproving(false);
    }
  };

  const enabledCounts = useMemo(() => {
    if (!data) return { modules: 0, items: 0 };
    let modules = 0;
    let items = 0;
    for (const module of data.library) {
      const sel = selections.modules[module.key];
      if (!sel?.enabled) continue;
      modules += 1;
      for (const item of module.items) {
        if (sel.items[item.key]?.enabled) items += 1;
      }
    }
    items += selections.customItems.length;
    return { modules, items };
  }, [data, selections]);

  if (loading) {
    return (
      <ECard>
        <ECardBody className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading property checklist…
        </ECardBody>
      </ECard>
    );
  }
  if (!data) return null;

  const featureGroups = Array.from(new Set(data.featureDefs.map((f) => f.group)));
  const approved = data.profile?.status === "APPROVED" && !dirty;

  return (
    <div className="space-y-4">
      {/* ── Status + approve ── */}
      <ECard>
        <ECardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <div className="min-w-0">
            <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
              <ClipboardCheck className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
              Property checklist
              {approved ? (
                <EBadge tone="success" soft>Approved</EBadge>
              ) : (
                <EBadge tone="neutral" soft>{dirty ? "Unsaved changes" : data.profile?.status ?? "Not set up"}</EBadge>
              )}
            </ECardTitle>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {enabledCounts.modules} sections · {enabledCounts.items} tasks selected. Toggle amenities and items,
              preview the exact cleaner form, then approve to generate this property&apos;s own form.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EButton size="sm" variant="outline" onClick={() => void save()} disabled={saving || !dirty}>
              <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save draft"}
            </EButton>
            <EButton size="sm" variant="gold" onClick={() => void approve()} disabled={approving}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {approving ? "Approving…" : "Approve & generate form"}
            </EButton>
          </div>
        </ECardHeader>
        <ECardBody className="pt-0">
          <p className="mb-1.5 text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">
            Generate for job types
          </p>
          <div className="flex flex-wrap gap-2">
            {data.jobTypes.map((jobType) => {
              const active = approveJobTypes.includes(jobType);
              return (
                <button
                  key={jobType}
                  type="button"
                  onClick={() =>
                    setApproveJobTypes((prev) =>
                      prev.includes(jobType) ? prev.filter((jt) => jt !== jobType) : [...prev, jobType],
                    )
                  }
                  className={`rounded-[var(--e-radius-pill)] border px-2.5 py-1 text-[0.75rem] transition-colors duration-[160ms] ${
                    active
                      ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                      : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:border-[hsl(var(--e-border-gold)/0.6)]"
                  }`}
                >
                  {prettyJobType(jobType)}
                </button>
              );
            })}
          </div>
        </ECardBody>
      </ECard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Left: amenities + modules + custom items ── */}
        <div className="space-y-4">
          <ECard>
            <ECardHeader className="pb-2">
              <ECardTitle className="flex items-center gap-2 text-[0.875rem]">
                <Sparkles className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" /> Amenities at this property
              </ECardTitle>
              <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                These switch matching checklist sections/items on or off automatically (you can still override below).
              </p>
            </ECardHeader>
            <ECardBody className="space-y-3 pt-0">
              {featureGroups.map((group) => (
                <div key={group}>
                  <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
                    {group.toLowerCase()}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                    {data.featureDefs
                      .filter((f) => f.group === group)
                      .map((feature) => (
                        <label key={feature.key} className="flex items-center gap-2 text-[0.8125rem]">
                          <input
                            type="checkbox"
                            className={CHECKBOX_CLASS}
                            checked={features[feature.key] === true}
                            onChange={() => toggleFeature(feature.key)}
                          />
                          <span>{feature.label}</span>
                        </label>
                      ))}
                  </div>
                </div>
              ))}
            </ECardBody>
          </ECard>

          <ECard>
            <ECardHeader className="pb-2">
              <ECardTitle className="text-[0.875rem]">Checklist sections</ECardTitle>
              <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Turn whole sections or individual tasks on/off for this property. Job-type chips control which
                services include a task.
              </p>
            </ECardHeader>
            <ECardBody className="space-y-2 pt-0">
              {data.library.map((module) => {
                const moduleSel = selections.modules[module.key] ?? { enabled: false, items: {} };
                const isOpen = expanded[module.key] === true;
                const onCount = module.items.filter((item) => moduleSel.items[item.key]?.enabled).length;
                return (
                  <div key={module.key} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        className="text-[hsl(var(--e-muted-foreground))]"
                        onClick={() => setExpanded((prev) => ({ ...prev, [module.key]: !isOpen }))}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.8125rem] font-[550]">{module.title}</p>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {onCount}/{module.items.length} tasks on · {module.category.toLowerCase()}
                        </p>
                      </div>
                      <ESwitch
                        checked={moduleSel.enabled}
                        onCheckedChange={(checked) => setModuleEnabled(module.key, checked)}
                      />
                    </div>
                    {isOpen ? (
                      <div className="space-y-1 border-t border-[hsl(var(--e-border))] px-3 py-2">
                        {module.items.map((item) => {
                          const itemSel = moduleSel.items[item.key] ?? { enabled: false };
                          const effectiveJobTypes =
                            itemSel.jobTypes ?? (item.jobTypes.length > 0 ? item.jobTypes : data.jobTypes);
                          return (
                            <div
                              key={item.key}
                              className="rounded-[var(--e-radius)] px-2 py-1.5 hover:bg-[hsl(var(--e-primary-soft)/0.35)]"
                            >
                              <label className="flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  className={`${CHECKBOX_CLASS} mt-0.5`}
                                  checked={itemSel.enabled}
                                  disabled={!moduleSel.enabled}
                                  onChange={(e) => setItemEnabled(module.key, item.key, e.target.checked)}
                                />
                                <span
                                  className={`text-[0.8125rem] ${
                                    !moduleSel.enabled ? "text-[hsl(var(--e-muted-foreground))]" : ""
                                  }`}
                                >
                                  {item.label}
                                </span>
                              </label>
                              {itemSel.enabled && moduleSel.enabled ? (
                                <div className="ml-6 mt-1 flex flex-wrap gap-1">
                                  {approveJobTypes.map((jobType) => {
                                    const on = effectiveJobTypes.includes(jobType);
                                    return (
                                      <button
                                        key={jobType}
                                        type="button"
                                        onClick={() => toggleItemJobType(module.key, item.key, item.jobTypes, jobType)}
                                        className={`rounded-[var(--e-radius-pill)] border px-1.5 py-0.5 text-[0.625rem] ${
                                          on
                                            ? "border-[hsl(var(--e-border-gold)/0.6)] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                                            : "border-[hsl(var(--e-border))] text-[hsl(var(--e-text-faint))] line-through"
                                        }`}
                                        title={`${on ? "Included in" : "Excluded from"} ${prettyJobType(jobType)}`}
                                      >
                                        {prettyJobType(jobType)}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </ECardBody>
          </ECard>

          <ECard>
            <ECardHeader className="pb-2">
              <ECardTitle className="text-[0.875rem]">Custom tasks for this property</ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-3 pt-0">
              {selections.customItems.length > 0 ? (
                <div className="space-y-1.5">
                  {selections.customItems.map((custom) => (
                    <div
                      key={custom.id}
                      className="flex items-start justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="text-[0.8125rem]">{custom.label}</p>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {custom.moduleKey ? `In ${custom.moduleKey}` : "Property-specific section"}
                        </p>
                      </div>
                      <EButton size="sm" variant="ghost" onClick={() => removeCustomItem(custom.id)} aria-label="Remove task">
                        <Trash2 className="h-3.5 w-3.5" />
                      </EButton>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No custom tasks yet.</p>
              )}
              <div className="space-y-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] p-3">
                <EInput
                  placeholder="Task label, e.g. Water the balcony plants"
                  value={newItemLabel}
                  onChange={(event) => setNewItemLabel(event.target.value)}
                />
                <ETextarea
                  placeholder="How-to instructions (optional)"
                  rows={2}
                  value={newItemInstructions}
                  onChange={(event) => setNewItemInstructions(event.target.value)}
                />
                <div className="flex items-center gap-2">
                  <ESelect
                    className="h-9 w-56"
                    value={newItemModule}
                    onChange={(event) => setNewItemModule(event.target.value)}
                  >
                    <option value="custom">Property-specific section</option>
                    {data.library.map((module) => (
                      <option key={module.key} value={module.key}>
                        {module.title}
                      </option>
                    ))}
                  </ESelect>
                  <EButton size="sm" variant="outline" onClick={addCustomItem} disabled={!newItemLabel.trim()}>
                    <Plus className="h-3.5 w-3.5" /> Add task
                  </EButton>
                </div>
              </div>
            </ECardBody>
          </ECard>
        </div>

        {/* ── Right: live cleaner-form preview ── */}
        <ECard className="lg:sticky lg:top-4 lg:self-start">
          <ECardHeader className="flex-row items-center justify-between gap-2 pb-2">
            <div className="min-w-0">
              <ECardTitle className="text-[0.875rem]">Cleaner form preview</ECardTitle>
              <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Exactly what the cleaner will see for this property.
              </p>
            </div>
            <ESelect
              className="h-9 w-48"
              value={previewJobType}
              onChange={(event) => setPreviewJobType(event.target.value)}
            >
              {data.jobTypes.map((jobType) => (
                <option key={jobType} value={jobType}>
                  {prettyJobType(jobType)}
                </option>
              ))}
            </ESelect>
          </ECardHeader>
          <ECardBody className="pt-0">
            {preview && preview.sections.length > 0 ? (
              <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                {preview.sections.map((section) => (
                  <div
                    key={section.id}
                    className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3"
                  >
                    <p className="text-[0.8125rem] font-semibold">{section.title}</p>
                    {section.description ? (
                      <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                        {section.description}
                      </p>
                    ) : null}
                    <div className="mt-2 space-y-1.5">
                      {section.fields.map((field) => (
                        <div
                          key={field.id}
                          className="flex items-start gap-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface))] px-2.5 py-1.5"
                        >
                          <span className="mt-0.5 inline-block h-3.5 w-3.5 flex-shrink-0 rounded border border-[hsl(var(--e-border-strong))]" />
                          <div className="min-w-0">
                            <p className="text-[0.8125rem] leading-snug">{field.label}</p>
                            {field.instructions ? (
                              <p className="mt-0.5 line-clamp-2 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                                {field.instructions}
                              </p>
                            ) : null}
                          </div>
                          {field.type !== "checkbox" ? (
                            <span className="ml-auto flex-shrink-0 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-1.5 py-0.5 text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">
                              {field.type}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Nothing selected for {prettyJobType(previewJobType)} yet — toggle sections on the left.
              </p>
            )}
          </ECardBody>
        </ECard>
      </div>
    </div>
  );
}

/* ── Per-property form template defaults (overrides) ───────────────────── */
type TemplateOption = { id: string; name: string; version: number };

export function PropertyFormOverrides({ propertyId }: { propertyId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [optionsByJobType, setOptionsByJobType] = useState<Record<string, TemplateOption[]>>({});
  const [globalDefaults, setGlobalDefaults] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/form-overrides`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load property form defaults.");
      setJobTypes(Array.isArray(body.jobTypes) ? body.jobTypes : []);
      setOptionsByJobType(
        body.templatesByJobType && typeof body.templatesByJobType === "object" ? body.templatesByJobType : {},
      );
      setGlobalDefaults(body.globalDefaults && typeof body.globalDefaults === "object" ? body.globalDefaults : {});
      setOverrides(body.overrides && typeof body.overrides === "object" ? body.overrides : {});
    } catch (err: any) {
      toast({
        title: "Could not load form defaults",
        description: err.message ?? "Please refresh and try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/form-overrides`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save form defaults.");
      toast({ title: "Form defaults updated" });
      await load();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message ?? "Could not save form defaults.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-2">
        <div className="min-w-0">
          <ECardTitle className="text-[0.95rem]">Property form defaults</ECardTitle>
          <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Set a default form template for each job type at this property. Leave on global to use the latest active
            template.
          </p>
        </div>
        <EButton size="sm" variant="gold" onClick={() => void save()} disabled={saving || loading}>
          <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save defaults"}
        </EButton>
      </ECardHeader>
      <ECardBody className="pt-0">
        {loading ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading template defaults…</p>
        ) : (
          <div className="space-y-3">
            {jobTypes.map((jobType) => {
              const options = optionsByJobType[jobType] ?? [];
              const selectedValue = overrides[jobType] ?? "__global__";
              const globalId = globalDefaults[jobType];
              const globalTemplate = options.find((option) => option.id === globalId);
              return (
                <div
                  key={jobType}
                  className="grid gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 md:grid-cols-[230px,1fr]"
                >
                  <div>
                    <p className="text-[0.8125rem] font-[550]">{prettyJobType(jobType)}</p>
                    <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {globalTemplate
                        ? `Global default: ${globalTemplate.name} (v${globalTemplate.version})`
                        : "Global default: none available"}
                    </p>
                  </div>
                  <ESelect
                    value={selectedValue}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setOverrides((prev) => {
                        const next = { ...prev };
                        if (nextValue === "__global__") {
                          delete next[jobType];
                        } else {
                          next[jobType] = nextValue;
                        }
                        return next;
                      });
                    }}
                  >
                    <option value="__global__">Use global latest active template</option>
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name} (v{option.version})
                      </option>
                    ))}
                  </ESelect>
                </div>
              );
            })}
          </div>
        )}
      </ECardBody>
    </ECard>
  );
}
