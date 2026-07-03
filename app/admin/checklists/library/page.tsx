"use client";

/**
 * Checklist library editor — the master database of checklist modules
 * (rooms / appliances / outdoor / extras) and their items, from which every
 * per-property checklist is composed. Seeded automatically from the built-in
 * catalog on first visit.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { BookOpen, ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";

interface FeatureDef {
  key: string;
  label: string;
}

interface LibraryItem {
  id: string;
  key: string;
  label: string;
  instructions: string | null;
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

export default function ChecklistLibraryPage() {
  const [modules, setModules] = useState<LibraryModule[]>([]);
  const [featureDefs, setFeatureDefs] = useState<FeatureDef[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
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
    } catch (err: any) {
      toast({ title: "Load failed", description: err.message, variant: "destructive" });
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
      toast({ title: "Update failed", description: body.error, variant: "destructive" });
      return false;
    }
    await load();
    return true;
  };

  const deleteModule = async (module: LibraryModule) => {
    if (!window.confirm(`Delete "${module.title}" and its ${module.items.length} item(s)? Properties keep their generated forms.`)) return;
    const res = await fetch(`/api/admin/checklist-library/${module.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Delete failed", description: body.error, variant: "destructive" });
      return;
    }
    toast({ title: "Module deleted" });
    await load();
  };

  const createModule = async () => {
    const title = newModuleTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      const key = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
      const res = await fetch("/api/admin/checklist-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, title, category: newModuleCategory }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create module.");
      setNewModuleTitle("");
      toast({ title: "Module created" });
      await load();
    } catch (err: any) {
      toast({ title: "Create failed", description: err.message, variant: "destructive" });
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
      toast({ title: "Item saved" });
      await load();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (item: LibraryItem) => {
    if (!window.confirm(`Delete "${item.label}"?`)) return;
    const res = await fetch(`/api/admin/checklist-library/items/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Delete failed", description: body.error, variant: "destructive" });
      return;
    }
    await load();
  };

  const createItem = async (module: LibraryModule, payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const label = String(payload.label ?? "").trim();
      const key = `${module.key}.${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`.slice(0, 110);
      const res = await fetch(`/api/admin/checklist-library/${module.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, key }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not add item.");
      setAddingItemTo(null);
      toast({ title: "Item added" });
      await load();
    } catch (err: any) {
      toast({ title: "Add failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BookOpen className="h-5 w-5" /> Checklist library
          </h1>
          <p className="text-sm text-muted-foreground">
            The master checklist database — organised by room/appliance modules. Every property&apos;s checklist
            is composed from these, filtered by its amenities.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/checklists/coverage">Property coverage →</Link>
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading library…
          </CardContent>
        </Card>
      ) : (
        <>
          {modules.map((module) => {
            const isOpen = expanded[module.id] === true;
            return (
              <Card key={module.id} className={module.isActive ? "" : "opacity-60"}>
                <CardHeader className="flex flex-row items-center gap-2 py-3">
                  <button
                    type="button"
                    className="text-muted-foreground"
                    onClick={() => setExpanded((prev) => ({ ...prev, [module.id]: !isOpen }))}
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                      {module.title}
                      <Badge variant="outline" className="text-[10px]">{module.category.toLowerCase()}</Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {ruleLabel(module.appliesWhen, featureDefs)}
                      </Badge>
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground">{module.items.length} items · key {module.key}</p>
                  </div>
                  <Select
                    value={module.appliesWhen?.feature ?? (module.appliesWhen?.propertyField === "hasBalcony" ? "__balcony" : "__always")}
                    onValueChange={(value) =>
                      patchModule(module.id, {
                        appliesWhen:
                          value === "__always"
                            ? null
                            : value === "__balcony"
                              ? { propertyField: "hasBalcony", equals: true }
                              : { feature: value },
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-44 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__always">Always applies</SelectItem>
                      <SelectItem value="__balcony">Needs balcony</SelectItem>
                      {featureDefs.map((feature) => (
                        <SelectItem key={feature.key} value={feature.key}>
                          Needs {feature.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Switch
                    checked={module.isActive}
                    onCheckedChange={(checked) => patchModule(module.id, { isActive: checked === true })}
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => deleteModule(module)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardHeader>
                {isOpen ? (
                  <CardContent className="space-y-1 border-t pt-3">
                    {module.items.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 ${item.isActive ? "" : "opacity-50"}`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setEditingItem({ moduleId: module.id, item })}
                        >
                          <p className="truncate text-sm">{item.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {item.fieldType}
                            {item.required ? " · required" : ""}
                            {item.appliesWhen?.feature ? ` · needs ${item.appliesWhen.feature}` : ""}
                            {item.jobTypes.length > 0 ? ` · ${item.jobTypes.length} job type(s)` : " · all job types"}
                          </p>
                        </button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteItem(item)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => setAddingItemTo(module)}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add item
                    </Button>
                  </CardContent>
                ) : null}
              </Card>
            );
          })}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Add a module</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Module title, e.g. Home gym"
                className="w-64"
                value={newModuleTitle}
                onChange={(event) => setNewModuleTitle(event.target.value)}
              />
              <Select value={newModuleCategory} onValueChange={setNewModuleCategory}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={createModule} disabled={busy || !newModuleTitle.trim()}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Create
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Item edit dialog ── */}
      <ItemDialog
        open={Boolean(editingItem)}
        title="Edit item"
        initial={editingItem?.item ?? null}
        jobTypes={jobTypes}
        featureDefs={featureDefs}
        busy={busy}
        onClose={() => setEditingItem(null)}
        onSave={saveItem}
      />
      {/* ── Item add dialog ── */}
      <ItemDialog
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

function ItemDialog({
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
  const [fieldType, setFieldType] = useState("checkbox");
  const [required, setRequired] = useState(false);
  const [defaultOn, setDefaultOn] = useState(true);
  const [featureRule, setFeatureRule] = useState("__always");
  const [selectedJobTypes, setSelectedJobTypes] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label ?? "");
    setInstructions(initial?.instructions ?? "");
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
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Task label</Label>
            <Input value={label} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">How-to instructions (reveal popup)</Label>
            <Textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Field type</Label>
              <Select value={fieldType} onValueChange={setFieldType}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checkbox">Checkbox</SelectItem>
                  <SelectItem value="yesno">Yes / No</SelectItem>
                  <SelectItem value="photo">Photo proof</SelectItem>
                  <SelectItem value="video">Video proof</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Auto-applies when</Label>
              <Select value={featureRule} onValueChange={setFeatureRule}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__always">Always</SelectItem>
                  <SelectItem value="__balcony">Property has balcony</SelectItem>
                  {featureDefs.map((feature) => (
                    <SelectItem key={feature.key} value={feature.key}>
                      Property has {feature.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={required} onCheckedChange={(checked) => setRequired(checked === true)} /> Required
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={defaultOn} onCheckedChange={(checked) => setDefaultOn(checked === true)} /> On by default
            </label>
          </div>
          <div>
            <Label className="text-xs">Included in job types (none selected = all)</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    {jobType.replace(/_/g, " ").toLowerCase()}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={busy || !label.trim()}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
