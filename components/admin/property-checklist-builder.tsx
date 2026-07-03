"use client";

/**
 * Per-property checklist builder — the editable, previewable checklist that
 * composes this property's cleaner form from the checklist library:
 *   amenities (features) → auto-selected modules/items → admin toggles →
 *   live preview → approve → generated FormTemplate(s) registered as this
 *   property's form overrides.
 *
 * Used on the property detail page (Forms tab) and by the onboarding wizard's
 * "Checklist Preview & Approval" step (via propertyId once the property exists).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";

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
  return jobType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PropertyChecklistBuilder({
  propertyId,
  apiBase: apiBaseProp,
  mode = "property",
  defaultJobTypes,
  onApproved,
  onDirtyChange,
}: {
  propertyId?: string;
  /** Override the API base (the onboarding wizard points this at the survey). */
  apiBase?: string;
  /** "survey" hides Approve (generation happens on onboarding approval). */
  mode?: "property" | "survey";
  /** Job types pre-ticked for approval (e.g. from onboarding cleaning types). */
  defaultJobTypes?: JobTypeValue[];
  onApproved?: (generated: Record<string, string>) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const apiBase = apiBaseProp ?? `/api/admin/properties/${propertyId}/checklist-profile`;
  const { toast } = useToast();
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
      const firstJobTypes =
        defaultJobTypes && defaultJobTypes.length > 0
          ? defaultJobTypes
          : Array.isArray(body.selectedJobTypes) && body.selectedJobTypes.length > 0
            ? body.selectedJobTypes
            : Object.keys(body.profile?.generatedTemplateIds ?? {}).length > 0
              ? Object.keys(body.profile.generatedTemplateIds)
              : ["AIRBNB_TURNOVER"];
      setApproveJobTypes(firstJobTypes.filter((jt: string) => body.jobTypes.includes(jt)));
      setPreviewJobType(firstJobTypes[0] && body.jobTypes.includes(firstJobTypes[0]) ? firstJobTypes[0] : "AIRBNB_TURNOVER");
      setDirty(false);
    } catch (err: any) {
      toast({ title: "Could not load checklist", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [apiBase, defaultJobTypes, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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

  const toggleItemJobType = (moduleKey: string, itemKey: string, libraryJobTypes: JobTypeValue[], jobType: JobTypeValue) => {
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
      onApproved?.(body.generated ?? {});
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
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading property checklist…
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const featureGroups = Array.from(new Set(data.featureDefs.map((f) => f.group)));

  return (
    <div className="space-y-4">
      {/* ── Status + actions ── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" />
              Property checklist
              {data.profile?.status === "APPROVED" && !dirty ? (
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Approved</Badge>
              ) : (
                <Badge variant="outline">{dirty ? "Unsaved changes" : data.profile?.status ?? "Not set up"}</Badge>
              )}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {enabledCounts.modules} sections · {enabledCounts.items} tasks selected. Toggle amenities and items,
              preview the exact cleaner form, then approve to generate this property&apos;s own form.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => save()} disabled={saving || !dirty}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Save draft
            </Button>
            {mode === "property" ? (
              <Button size="sm" onClick={approve} disabled={approving}>
                {approving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                Approve &amp; generate form
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Generate for job types</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {data.jobTypes.map((jobType) => {
                const active = approveJobTypes.includes(jobType);
                return (
                  <button
                    key={jobType}
                    type="button"
                    onClick={() =>
                      setApproveJobTypes((prev) =>
                        prev.includes(jobType) ? prev.filter((jt) => jt !== jobType) : [...prev, jobType]
                      )
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {prettyJobType(jobType)}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Left: amenities + modules ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Amenities at this property
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                These switch matching checklist sections/items on or off automatically (you can still override below).
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {featureGroups.map((group) => (
                <div key={group}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.toLowerCase()}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                    {data.featureDefs
                      .filter((f) => f.group === group)
                      .map((feature) => (
                        <label key={feature.key} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={features[feature.key] === true}
                            onCheckedChange={() => toggleFeature(feature.key)}
                          />
                          <span>{feature.label}</span>
                        </label>
                      ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Checklist sections</CardTitle>
              <p className="text-xs text-muted-foreground">
                Turn whole sections or individual tasks on/off for this property. Job-type chips control which
                services include a task.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.library.map((module) => {
                const moduleSel = selections.modules[module.key] ?? { enabled: false, items: {} };
                const isOpen = expanded[module.key] === true;
                const onCount = module.items.filter((item) => moduleSel.items[item.key]?.enabled).length;
                return (
                  <div key={module.key} className="rounded-lg border">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        className="text-muted-foreground"
                        onClick={() => setExpanded((prev) => ({ ...prev, [module.key]: !isOpen }))}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{module.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {onCount}/{module.items.length} tasks on · {module.category.toLowerCase()}
                        </p>
                      </div>
                      <Switch
                        checked={moduleSel.enabled}
                        onCheckedChange={(checked) => setModuleEnabled(module.key, checked === true)}
                      />
                    </div>
                    {isOpen ? (
                      <div className="space-y-1 border-t px-3 py-2">
                        {module.items.map((item) => {
                          const itemSel = moduleSel.items[item.key] ?? { enabled: false };
                          const effectiveJobTypes =
                            itemSel.jobTypes ?? (item.jobTypes.length > 0 ? item.jobTypes : data.jobTypes);
                          return (
                            <div key={item.key} className="rounded-md px-2 py-1.5 hover:bg-muted/50">
                              <label className="flex items-start gap-2">
                                <Checkbox
                                  className="mt-0.5"
                                  checked={itemSel.enabled}
                                  disabled={!moduleSel.enabled}
                                  onCheckedChange={(checked) =>
                                    setItemEnabled(module.key, item.key, checked === true)
                                  }
                                />
                                <span className={`text-sm ${!moduleSel.enabled ? "text-muted-foreground" : ""}`}>
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
                                        onClick={() =>
                                          toggleItemJobType(module.key, item.key, item.jobTypes, jobType)
                                        }
                                        className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                                          on
                                            ? "border-primary/50 bg-primary/10 text-primary"
                                            : "border-border text-muted-foreground line-through"
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Custom tasks for this property</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selections.customItems.length > 0 ? (
                <div className="space-y-1.5">
                  {selections.customItems.map((custom) => (
                    <div key={custom.id} className="flex items-start justify-between gap-2 rounded-md border px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-sm">{custom.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {custom.moduleKey ? `In ${custom.moduleKey}` : "Property-specific section"}
                        </p>
                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeCustomItem(custom.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No custom tasks yet.</p>
              )}
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <Input
                  placeholder="Task label, e.g. Water the balcony plants"
                  value={newItemLabel}
                  onChange={(event) => setNewItemLabel(event.target.value)}
                />
                <Textarea
                  placeholder="How-to instructions (optional)"
                  rows={2}
                  value={newItemInstructions}
                  onChange={(event) => setNewItemInstructions(event.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Select value={newItemModule} onValueChange={setNewItemModule}>
                    <SelectTrigger className="h-9 w-56">
                      <SelectValue placeholder="Section" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Property-specific section</SelectItem>
                      {data.library.map((module) => (
                        <SelectItem key={module.key} value={module.key}>
                          {module.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={addCustomItem} disabled={!newItemLabel.trim()}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add task
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: live preview ── */}
        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Cleaner form preview</CardTitle>
              <p className="text-xs text-muted-foreground">Exactly what the cleaner will see for this property.</p>
            </div>
            <Select value={previewJobType} onValueChange={setPreviewJobType}>
              <SelectTrigger className="h-8 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.jobTypes.map((jobType) => (
                  <SelectItem key={jobType} value={jobType}>
                    {prettyJobType(jobType)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {preview && preview.sections.length > 0 ? (
              <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                {preview.sections.map((section) => (
                  <div key={section.id} className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-sm font-semibold">{section.title}</p>
                    {section.description ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{section.description}</p>
                    ) : null}
                    <div className="mt-2 space-y-1.5">
                      {section.fields.map((field) => (
                        <div key={field.id} className="flex items-start gap-2 rounded-md bg-background px-2.5 py-1.5">
                          <span className="mt-0.5 inline-block h-3.5 w-3.5 flex-shrink-0 rounded border border-muted-foreground/40" />
                          <div className="min-w-0">
                            <p className="text-sm leading-snug">{field.label}</p>
                            {field.instructions ? (
                              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{field.instructions}</p>
                            ) : null}
                          </div>
                          {field.type !== "checkbox" ? (
                            <Badge variant="outline" className="ml-auto flex-shrink-0 text-[10px]">
                              {field.type}
                            </Badge>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing selected for {prettyJobType(previewJobType)} yet — toggle sections on the left.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
