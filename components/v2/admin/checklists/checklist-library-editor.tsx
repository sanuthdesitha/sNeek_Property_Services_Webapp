"use client";

/**
 * ESTATE — Checklist library editor (native v2 port of app/admin/checklists/library).
 * Master database of checklist modules (room / appliance / outdoor / safety / extra)
 * and their items, from which every per-property checklist is composed. Seeded from
 * the built-in catalog on first visit by the API.
 *
 * Endpoints (unchanged from v1):
 *   GET    /api/admin/checklist-library                         → { modules, featureDefs, jobTypes }
 *   POST   /api/admin/checklist-library                         { key, title, category }
 *   PATCH  /api/admin/checklist-library/:moduleId              { appliesWhen? | isActive? }
 *   DELETE /api/admin/checklist-library/:moduleId
 *   POST   /api/admin/checklist-library/:moduleId/items         { ...payload, key }
 *   PATCH  /api/admin/checklist-library/items/:itemId          { ...payload }
 *   DELETE /api/admin/checklist-library/items/:itemId
 */

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import {
  EButton,
  ECard,
  EBadge,
  EEmptyState,
  EAlert,
} from "@/components/v2/ui/primitives";
import {
  EInput,
  ETextarea,
  ESelect,
  EField,
  ESwitch,
  EModal,
} from "@/components/v2/admin/estate-kit";
import { TaskImageUpload } from "@/components/v2/admin/forms/management/estate-checklists-workspace";

interface FeatureDef {
  key: string;
  label: string;
}

interface LibraryItem {
  id: string;
  key: string;
  label: string;
  instructions: string | null;
  imageUrl?: string | null;
  fieldType: string;
  required: boolean;
  defaultOn: boolean;
  jobTypes: string[];
  appliesWhen: { feature?: string; propertyField?: string; equals?: unknown } | null;
  isActive: boolean;
}

interface LibraryModule {
  id: string;
  key: string;
  title: string;
  category: string;
  appliesWhen: { feature?: string; propertyField?: string; equals?: unknown } | null;
  isActive: boolean;
  items: LibraryItem[];
}

const CATEGORIES = ["ROOM", "APPLIANCE", "OUTDOOR", "SAFETY", "EXTRA"];

function ruleLabel(rule: LibraryModule["appliesWhen"], featureDefs: FeatureDef[]) {
  if (!rule) return "Always applies";
  if (rule.feature) {
    const def = featureDefs.find((f) => f.key === rule.feature);
    return `Needs: ${def?.label ?? rule.feature}`;
  }
  if (rule.propertyField) return `Needs: ${rule.propertyField}`;
  return "Always applies";
}

export function EstateChecklistLibrary() {
  const [modules, setModules] = useState<LibraryModule[]>([]);
  const [featureDefs, setFeatureDefs] = useState<FeatureDef[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingItem, setEditingItem] = useState<{ moduleId: string; item: LibraryItem } | null>(null);
  const [addingItemTo, setAddingItemTo] = useState<LibraryModule | null>(null);
  const [busy, setBusy] = useState(false);
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [newModuleCategory, setNewModuleCategory] = useState("ROOM");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/checklist-library", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load the library.");
      setModules(body.modules ?? []);
      setFeatureDefs(body.featureDefs ?? []);
      setJobTypes(body.jobTypes ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Could not load the library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchModule = async (moduleId: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/checklist-library/${moduleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Update failed.");
      return false;
    }
    await load();
    return true;
  };

  const deleteModule = async (module: LibraryModule) => {
    if (
      !window.confirm(
        `Delete "${module.title}" and its ${module.items.length} item(s)? Properties keep their generated forms.`
      )
    )
      return;
    const res = await fetch(`/api/admin/checklist-library/${module.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Delete failed.");
      return;
    }
    await load();
  };

  const createModule = async () => {
    const title = newModuleTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      const key = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50);
      const res = await fetch("/api/admin/checklist-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, title, category: newModuleCategory }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create module.");
      setNewModuleTitle("");
      await load();
    } catch (err: any) {
      setError(err.message ?? "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveItem = async (payload: Record<string, unknown>) => {
    if (!editingItem) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/checklist-library/items/${editingItem.item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save item.");
      setEditingItem(null);
      await load();
    } catch (err: any) {
      setError(err.message ?? "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (item: LibraryItem) => {
    if (!window.confirm(`Delete "${item.label}"?`)) return;
    const res = await fetch(`/api/admin/checklist-library/items/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Delete failed.");
      return;
    }
    await load();
  };

  const createItem = async (module: LibraryModule, payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const label = String(payload.label ?? "").trim();
      const key = `${module.key}.${label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`.slice(0, 110);
      const res = await fetch(`/api/admin/checklist-library/${module.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, key }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not add item.");
      setAddingItemTo(null);
      await load();
    } catch (err: any) {
      setError(err.message ?? "Add failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <EAlert tone="danger" title="Something went wrong">
          {error}
        </EAlert>
      ) : null}

      {loading ? (
        <ECard className="flex items-center gap-2 p-8 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading library…
        </ECard>
      ) : modules.length === 0 ? (
        <EEmptyState
          eyebrow="Checklist library"
          title="No modules yet"
          description="Add a room, appliance, or outdoor module below to begin composing property checklists."
        />
      ) : (
        modules.map((module) => {
          const isOpen = expanded[module.id] === true;
          return (
            <ECard key={module.id} className={module.isActive ? "" : "opacity-60"}>
              <div className="flex flex-wrap items-center gap-3 p-4">
                <button
                  type="button"
                  className="text-[hsl(var(--e-muted-foreground))]"
                  onClick={() => setExpanded((prev) => ({ ...prev, [module.id]: !isOpen }))}
                  aria-label={isOpen ? "Collapse module" : "Expand module"}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-[hsl(var(--e-foreground))]">
                      {module.title}
                    </span>
                    <EBadge tone="gold" soft>
                      {module.category.toLowerCase()}
                    </EBadge>
                    <EBadge tone="neutral">{ruleLabel(module.appliesWhen, featureDefs)}</EBadge>
                  </div>
                  <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {module.items.length} items · key {module.key}
                  </p>
                </div>
                <ESelect
                  className="h-8 w-48 text-[0.8125rem]"
                  value={
                    module.appliesWhen?.feature ??
                    (module.appliesWhen?.propertyField === "hasBalcony" ? "__balcony" : "__always")
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    void patchModule(module.id, {
                      appliesWhen:
                        value === "__always"
                          ? null
                          : value === "__balcony"
                            ? { propertyField: "hasBalcony", equals: true }
                            : { feature: value },
                    });
                  }}
                >
                  <option value="__always">Always applies</option>
                  <option value="__balcony">Needs balcony</option>
                  {featureDefs.map((feature) => (
                    <option key={feature.key} value={feature.key}>
                      Needs {feature.label}
                    </option>
                  ))}
                </ESelect>
                <ESwitch
                  checked={module.isActive}
                  onCheckedChange={(checked) => void patchModule(module.id, { isActive: checked })}
                />
                <EButton
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => void deleteModule(module)}
                  aria-label="Delete module"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </EButton>
              </div>

              {isOpen ? (
                <div className="space-y-1 border-t border-[hsl(var(--e-border))] p-4">
                  {module.items.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 rounded-[var(--e-radius)] px-2 py-1.5 hover:bg-[hsl(var(--e-muted))] ${
                        item.isActive ? "" : "opacity-50"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setEditingItem({ moduleId: module.id, item })}
                      >
                        <p className="truncate text-[0.875rem] text-[hsl(var(--e-foreground))]">{item.label}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {item.fieldType}
                          {item.required ? " · required" : ""}
                          {item.appliesWhen?.feature ? ` · needs ${item.appliesWhen.feature}` : ""}
                          {item.jobTypes.length > 0 ? ` · ${item.jobTypes.length} job type(s)` : " · all job types"}
                        </p>
                      </button>
                      <EButton
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => void deleteItem(item)}
                        aria-label="Delete item"
                      >
                        <Trash2 className="h-3 w-3" />
                      </EButton>
                    </div>
                  ))}
                  <EButton
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => setAddingItemTo(module)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add item
                  </EButton>
                </div>
              ) : null}
            </ECard>
          );
        })
      )}

      {/* Add a module */}
      {!loading ? (
        <ECard className="p-5">
          <div className="mb-3 flex items-center gap-2 text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">
            <BookOpen className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" /> Add a module
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <EField label="Module title" className="min-w-[16rem] flex-1">
              <EInput
                placeholder="e.g. Home gym"
                value={newModuleTitle}
                onChange={(event) => setNewModuleTitle(event.target.value)}
              />
            </EField>
            <EField label="Category" className="w-44">
              <ESelect value={newModuleCategory} onChange={(e) => setNewModuleCategory(e.target.value)}>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category.toLowerCase()}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EButton size="md" onClick={() => void createModule()} disabled={busy || !newModuleTitle.trim()}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              Create
            </EButton>
          </div>
        </ECard>
      ) : null}

      {/* Item edit modal */}
      <ItemModal
        open={Boolean(editingItem)}
        title="Edit item"
        initial={editingItem?.item ?? null}
        jobTypes={jobTypes}
        featureDefs={featureDefs}
        busy={busy}
        onClose={() => setEditingItem(null)}
        onSave={saveItem}
      />
      {/* Item add modal */}
      <ItemModal
        open={Boolean(addingItemTo)}
        title={`Add item to ${addingItemTo?.title ?? ""}`}
        initial={null}
        jobTypes={jobTypes}
        featureDefs={featureDefs}
        busy={busy}
        onClose={() => setAddingItemTo(null)}
        onSave={(payload) => (addingItemTo ? createItem(addingItemTo, payload) : Promise.resolve())}
      />
    </div>
  );
}

function ItemModal({
  open,
  title,
  initial,
  jobTypes,
  featureDefs,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initial: LibraryItem | null;
  jobTypes: string[];
  featureDefs: FeatureDef[];
  busy: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [instructions, setInstructions] = useState("");
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [fieldType, setFieldType] = useState("checkbox");
  const [required, setRequired] = useState(false);
  const [defaultOn, setDefaultOn] = useState(true);
  const [featureRule, setFeatureRule] = useState("__always");
  const [selectedJobTypes, setSelectedJobTypes] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label ?? "");
    setInstructions(initial?.instructions ?? "");
    setImageUrl(initial?.imageUrl ?? undefined);
    setFieldType(initial?.fieldType ?? "checkbox");
    setRequired(initial?.required ?? false);
    setDefaultOn(initial?.defaultOn ?? true);
    setFeatureRule(
      initial?.appliesWhen?.feature ??
        (initial?.appliesWhen?.propertyField === "hasBalcony" ? "__balcony" : "__always")
    );
    setSelectedJobTypes(initial?.jobTypes ?? []);
  }, [open, initial]);

  const submit = () => {
    void onSave({
      label: label.trim(),
      instructions: instructions.trim() || null,
      imageUrl: imageUrl ?? null,
      fieldType,
      required,
      defaultOn,
      jobTypes: selectedJobTypes,
      appliesWhen:
        featureRule === "__always"
          ? null
          : featureRule === "__balcony"
            ? { propertyField: "hasBalcony", equals: true }
            : { feature: featureRule },
    });
  };

  return (
    <EModal open={open} onClose={onClose} title={title} eyebrow="Checklist item" wide>
      <div className="space-y-4">
        <EField label="Task label">
          <EInput value={label} onChange={(event) => setLabel(event.target.value)} />
        </EField>
        <EField label="How-to instructions (reveal popup)">
          <ETextarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
        </EField>
        <EField label="Reference image (shown to the cleaner)">
          <TaskImageUpload imageUrl={imageUrl} onChange={setImageUrl} />
        </EField>
        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="Field type">
            <ESelect value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
              <option value="checkbox">Checkbox</option>
              <option value="yesno">Yes / No</option>
              <option value="photo">Photo proof</option>
              <option value="video">Video proof</option>
            </ESelect>
          </EField>
          <EField label="Auto-applies when">
            <ESelect value={featureRule} onChange={(e) => setFeatureRule(e.target.value)}>
              <option value="__always">Always</option>
              <option value="__balcony">Property has balcony</option>
              {featureDefs.map((feature) => (
                <option key={feature.key} value={feature.key}>
                  Property has {feature.label}
                </option>
              ))}
            </ESelect>
          </EField>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <ESwitch checked={required} onCheckedChange={setRequired} label="Required" />
          <ESwitch checked={defaultOn} onCheckedChange={setDefaultOn} label="On by default" />
        </div>
        <EField label="Included in job types (none selected = all)">
          <div className="mt-1 flex flex-wrap gap-1.5">
            {jobTypes.map((jobType) => {
              const active = selectedJobTypes.includes(jobType);
              return (
                <button
                  key={jobType}
                  type="button"
                  onClick={() =>
                    setSelectedJobTypes((prev) =>
                      prev.includes(jobType) ? prev.filter((jt) => jt !== jobType) : [...prev, jobType]
                    )
                  }
                  className={`rounded-[var(--e-radius-pill)] border px-2.5 py-0.5 text-[0.6875rem] font-[550] tracking-[0.02em] transition-colors ${
                    active
                      ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                      : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))]"
                  }`}
                >
                  {jobType.replace(/_/g, " ").toLowerCase()}
                </button>
              );
            })}
          </div>
        </EField>
        <div className="flex justify-end gap-2 pt-1">
          <EButton variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </EButton>
          <EButton size="sm" onClick={submit} disabled={busy || !label.trim()}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
