"use client";

/**
 * ESTATE QA templates (Forms → QA templates tab).
 *   GET    /api/admin/qa/templates            → { templates (+ revisions), properties, jobTypes, conflicts }
 *   POST   /api/admin/qa/templates            { name?, serviceType, propertyId?, templateSchema? }
 *   PATCH  /api/admin/qa/templates/[id]       { name?, isActive?, templateSchema? } (content change = new revision)
 *   POST   /api/admin/qa/templates/[id]/duplicate
 *   DELETE /api/admin/qa/templates/[id]       (deactivates instead when inspections used it)
 * Writes are ADMIN only. `canWrite` (decided on the server from the viewer's
 * held roles) hides every write control for everyone else.
 */
import { useEffect, useState } from "react";
import { JobType } from "@prisma/client";
import { ClipboardCheck, Plus, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { buildDefaultQaTemplateSchema, jobTypeLabel } from "@/lib/qa/templates";
import { findQaTemplateConflicts, type QaTemplateConflict } from "@/lib/qa/template-conflicts";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EConfirmModal, EField, EInput, EModal, ESelect, ESwitch, ETableShell } from "@/components/v2/admin/estate-kit";
import { QaTemplateEditor, type PropertyOption, type TemplateRow } from "./qa-template-editor";
import { QaTemplatePreview } from "./qa-template-preview";
import { filterAndSortQaTemplates, type QaSort } from "./qa-template-list";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";

type Row = TemplateRow & { revisions?: number | null };

export function QaTemplatesManager({ canWrite = false }: { canWrite?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Row[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [jobTypeFilter, setJobTypeFilter] = useState<string>("all");
  const [scopeFilter, setScopeFilter] = useState<string>("all");
  const [sort, setSort] = useState<QaSort>("jobType");

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<JobType>(JobType.AIRBNB_TURNOVER);
  const [createPropertyId, setCreatePropertyId] = useState("__global");
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [previewing, setPreviewing] = useState<TemplateRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reset-to-default confirm
  const [resetFor, setResetFor] = useState<TemplateRow | null>(null);
  const [resetting, setResetting] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/qa/templates", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(body.error ?? "Could not load QA templates.");
        return;
      }
      setTemplates(Array.isArray(body.templates) ? body.templates : []);
      setProperties(Array.isArray(body.properties) ? body.properties : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createTemplate() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/qa/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim() || undefined,
          serviceType: createType,
          propertyId: createPropertyId === "__global" ? null : createPropertyId,
          // Omitted templateSchema → the server seeds the detailed default
          // schema for the chosen job type (same as v1's prefilled JSON).
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Template create failed", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "QA template created", description: "It starts from the default schema — open it to tailor sections." });
      setCreateOpen(false);
      setCreateName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(template: TemplateRow) {
    const res = await fetch(`/api/admin/qa/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !template.isActive }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Update failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    await load();
  }

  async function confirmReset() {
    if (!resetFor) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/qa/templates/${resetFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateSchema: buildDefaultQaTemplateSchema(resetFor.serviceType) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Reset failed", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "Reset to detailed default", description: "The form now uses the latest area-based sections." });
      setResetFor(null);
      await load();
    } finally {
      setResetting(false);
    }
  }

  async function duplicate(template: Row) {
    const res = await fetch(`/api/admin/qa/templates/${template.id}/duplicate`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Duplicate failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    toast({ title: "Copy created", description: "It is switched off until you turn it on, so inspections keep using the current template." });
    await load();
  }

  async function confirmDelete() {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/qa/templates/${deleteFor.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Delete failed", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast(
        body.outcome === "deactivated"
          ? { title: "Switched off instead of deleted", description: `${body.inspections} inspection${body.inspections === 1 ? "" : "s"} used it, so it is kept for their history.` }
          : { title: "QA template deleted" },
      );
      setDeleteFor(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  const conflicts: QaTemplateConflict[] = findQaTemplateConflicts(templates.map((t) => ({ ...t, serviceType: String(t.serviceType) })));
  const conflictFor = (id: string) => conflicts.find((conflict) => conflict.templateIds.includes(id));
  const nameOf = (id: string | null) => templates.find((t) => t.id === id)?.name ?? "either one";
  const visible = filterAndSortQaTemplates(templates, { jobType: jobTypeFilter, scope: scopeFilter, sort });
  const jobTypesInUse = Array.from(new Set(templates.map((t) => String(t.serviceType)))).sort();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Scoring forms QA inspectors fill in — global per job type, with optional per-property overrides.
        </p>
        <div className="flex items-center gap-2">
          <EButton size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </EButton>
          {canWrite ? (
            <EButton size="sm" variant="gold" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New template
            </EButton>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <EField label="Job type" className="min-w-[12rem]">
          <ESelect value={jobTypeFilter} onChange={(e) => setJobTypeFilter(e.target.value)}>
            <option value="all">All job types</option>
            {jobTypesInUse.map((type) => (
              <option key={type} value={type}>{jobTypeLabel(type as JobType)}</option>
            ))}
          </ESelect>
        </EField>
        <EField label="Scope" className="min-w-[12rem]">
          <ESelect value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
            <option value="all">Global and property</option>
            <option value="global">Global defaults</option>
            <option value="property">Property overrides</option>
          </ESelect>
        </EField>
        <EField label="Sort by" className="min-w-[12rem]">
          <ESelect value={sort} onChange={(e) => setSort(e.target.value as QaSort)}>
            <option value="jobType">Job type</option>
            <option value="scope">Scope</option>
            <option value="name">Name</option>
            <option value="version">Version (newest first)</option>
          </ESelect>
        </EField>
      </div>

      {conflicts.length > 0 ? (
        <div role="alert" className={`space-y-1 rounded-[var(--e-radius)] ${toneNoticeClass("attention")} px-3 py-2 text-[0.8125rem]`}>
          <p className="font-[600]">Two or more active templates share a job type and scope</p>
          {conflicts.map((conflict) => (
            <p key={`${conflict.serviceType}-${conflict.propertyId ?? "global"}`}>
              {jobTypeLabel(conflict.serviceType as JobType)} · {conflict.propertyId ? properties.find((p) => p.id === conflict.propertyId)?.name ?? "a property" : "global"}:{" "}
              {conflict.resolvesToId
                ? `inspections use “${nameOf(conflict.resolvesToId)}” (highest version).`
                : "the top versions are equal, so either may be used."}{" "}
              Switch the others off to make it certain.
            </p>
          ))}
        </div>
      ) : null}

      <ECard className="overflow-hidden p-0">
        {loading ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : loadError ? (
          <p role="alert" className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-danger))]">{loadError}</p>
        ) : templates.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No QA templates yet — create one to start scoring inspections.
          </p>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No QA templates match these filters.</p>
        ) : (
          <ETableShell
            headers={[
              { label: "Template" },
              { label: "Job type" },
              { label: "Scope" },
              { label: "Version", align: "center" },
              { label: "Revisions", align: "center" },
              { label: "Active", align: "center" },
              { label: "", align: "right" },
            ]}
          >
            {visible.map((template) => {
              const conflict = template.isActive ? conflictFor(template.id) : undefined;
              return (
                <tr key={template.id} className={template.isActive ? "" : "opacity-60"}>
                  <td className="px-4 py-3">
                    <span className="inline-flex flex-wrap items-center gap-2 font-[550] text-[hsl(var(--e-foreground))]">
                      <ClipboardCheck className="h-3.5 w-3.5 text-[hsl(var(--e-gold-ink))]" />
                      {template.name}
                      {conflict ? (
                        <EBadge tone="warning" soft>{conflict.resolvesToId === template.id ? "In use (overlap)" : "Overlaps — not used"}</EBadge>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{jobTypeLabel(template.serviceType)}</td>
                  <td className="px-4 py-3">
                    {template.property ? (
                      <EBadge tone="info" soft>{template.property.name} ({template.property.suburb})</EBadge>
                    ) : (
                      <EBadge tone="neutral" soft>Global default</EBadge>
                    )}
                  </td>
                  <td className="e-tnum px-4 py-3 text-center text-[hsl(var(--e-muted-foreground))]">v{template.version}</td>
                  <td className="e-tnum px-4 py-3 text-center text-[hsl(var(--e-muted-foreground))]">
                    {template.revisions === null || template.revisions === undefined ? "–" : template.revisions}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ESwitch checked={template.isActive} disabled={!canWrite} onCheckedChange={() => void toggleActive(template)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <EButton size="sm" variant="outline" onClick={() => setPreviewing(template)}>Preview</EButton>
                      {!canWrite ? <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Read only</span> : null}
                      {canWrite ? (
                        <ERowMenu
                          label={`More actions for ${template.name}`}
                          items={[
                            { key: "edit", label: "Edit", onSelect: () => setEditing(template) },
                            { key: "duplicate", label: "Duplicate", onSelect: () => void duplicate(template) },
                            { key: "reset", label: "Reset to default", onSelect: () => setResetFor(template) },
                            { key: "delete", label: "Delete", danger: true, separated: true, onSelect: () => setDeleteFor(template) },
                          ]}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </ETableShell>
        )}
      </ECard>

      {/* Create */}
      <EModal open={createOpen} onClose={() => setCreateOpen(false)} eyebrow="QA templates" title="New QA template">
        <div className="space-y-4">
          <EField label="Name" hint="Leave blank for an automatic name.">
            <EInput
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Default QA — Airbnb turnover"
            />
          </EField>
          <EField label="Job type">
            <ESelect value={createType} onChange={(e) => setCreateType(e.target.value as JobType)}>
              {Object.values(JobType).map((type) => (
                <option key={type} value={type}>
                  {jobTypeLabel(type)}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Property override" hint="Global templates apply everywhere; a property override wins for that property.">
            <ESelect value={createPropertyId} onChange={(e) => setCreatePropertyId(e.target.value)}>
              <option value="__global">Global default</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name} ({property.suburb})
                </option>
              ))}
            </ESelect>
          </EField>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            The template starts from the detailed default sections for the job type — edit it after creating.
          </p>
          <EButton className="w-full" variant="gold" onClick={() => void createTemplate()} disabled={creating}>
            {creating ? "Creating…" : "Create template"}
          </EButton>
        </div>
      </EModal>

      <QaTemplateEditor template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      <QaTemplatePreview template={previewing} onClose={() => setPreviewing(null)} />

      <EConfirmModal
        open={Boolean(deleteFor)}
        onClose={() => setDeleteFor(null)}
        title={`Delete "${deleteFor?.name ?? "template"}"?`}
        description="If any inspection used it, it is switched off instead so those inspections keep their template. Otherwise it is removed."
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
      />

      {/* Reset to default */}
      <EConfirmModal
        open={Boolean(resetFor)}
        onClose={() => setResetFor(null)}
        title={`Reset "${resetFor?.name ?? "template"}" to default?`}
        tier="ordinary"
        description="This replaces its scoring sections with the latest detailed default for the job type. Existing submissions are unaffected."
        confirmLabel="Reset to default"
        loading={resetting}
        onConfirm={confirmReset}
      />
    </div>
  );
}
