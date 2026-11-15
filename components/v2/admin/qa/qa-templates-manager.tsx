"use client";

/**
 * ESTATE QA templates (Forms → QA templates tab; board "QA templates",
 * 2026-11-17).
 *   GET    /api/admin/qa/templates            → { templates (+ revisions, inspections30d), properties, jobTypes, conflicts }
 *   POST   /api/admin/qa/templates            { name?, serviceType, propertyId?, templateSchema? }
 *   PATCH  /api/admin/qa/templates/[id]       { name?, isActive?, templateSchema?, expectedUpdatedAt? } (content change = new revision)
 *   POST   /api/admin/qa/templates/[id]/duplicate
 *   DELETE /api/admin/qa/templates/[id]       (switches off instead when inspections used it)
 * Writes are ADMIN only, as today. `canWrite` (decided on the server from the
 * viewer's held roles) hides every write control for everyone else; they see
 * the list, the overlap band and the editor read only ("View").
 *
 * The overlap between active templates of one job type and scope is ONE
 * honey band above the list naming the templates and the fix, and the rows
 * say "In use (overlap)" and "Overlaps, not used" in words. It warns; nothing
 * refuses a save. Reset is tier A, Delete tier B.
 */
import { useCallback, useEffect, useState } from "react";
import { JobType } from "@prisma/client";
import { toast } from "@/hooks/use-toast";
import { buildDefaultQaTemplateSchema, jobTypeLabel } from "@/lib/qa/templates";
import { findQaTemplateConflicts, type QaTemplateConflict } from "@/lib/qa/template-conflicts";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { toneBandClass, toneRowCellClass, tonePillClass } from "@/components/v2/ui/tone-band";
import { EField, EInput, EModal, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import { QaTemplateEditor, type PropertyOption, type TemplateRow } from "./qa-template-editor";
import { filterAndSortQaTemplates, type QaSort } from "./qa-template-list";

type Row = TemplateRow & { revisions?: number | null; inspections30d?: number | null };
type LoadState = { status: "loading" | "failed" | "ready"; error: string | null };

const DATE = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Sydney" });

function shortDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE.format(date);
}

function inspectionWords(count: number | null | undefined): string {
  if (count === null || count === undefined) return "–";
  if (count === 0) return "None in 30 days";
  return `${count} inspection${count === 1 ? "" : "s"}, 30 days`;
}

export function QaTemplatesManager({ canWrite = false }: { canWrite?: boolean }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading", error: null });
  const [templates, setTemplates] = useState<Row[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [jobTypeFilter, setJobTypeFilter] = useState<string>("all");
  const [scopeFilter, setScopeFilter] = useState<string>("all");
  const [sort, setSort] = useState<QaSort>("version");

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<JobType>(JobType.AIRBNB_TURNOVER);
  const [createPropertyId, setCreatePropertyId] = useState("__global");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<Row | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoad((current) => ({ status: "loading", error: current.error }));
    try {
      const res = await fetch("/api/admin/qa/templates", { cache: "no-store", signal });
      const body = await res.json().catch(() => ({}));
      if (signal?.aborted) return;
      if (!res.ok) {
        setLoad({ status: "failed", error: body.error ?? "QA templates could not be loaded. Try again." });
        return;
      }
      setTemplates(Array.isArray(body.templates) ? body.templates : []);
      setProperties(Array.isArray(body.properties) ? body.properties : []);
      setLoad({ status: "ready", error: null });
    } catch {
      if (!signal?.aborted) setLoad({ status: "failed", error: "QA templates could not be loaded. Try again." });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

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
          // Omitted templateSchema → the server seeds the detailed default schema for the job type.
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
      await reload();
      if (typeof body.id === "string") setEditingId(body.id);
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(template: Row) {
    const res = await fetch(`/api/admin/qa/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !template.isActive }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Not changed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    await reload();
  }

  async function confirmReset() {
    if (!resetFor) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch(`/api/admin/qa/templates/${resetFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateSchema: buildDefaultQaTemplateSchema(resetFor.serviceType) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetError(`It was not reset: ${body.error ?? `the server answered ${res.status}`}.`);
        return;
      }
      toast({ title: "Reset to detailed default", description: "The form now uses the latest area-based sections." });
      setResetFor(null);
      setEditingId(null);
      await reload();
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
    await reload();
  }

  async function confirmDelete() {
    if (!deleteFor) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/qa/templates/${deleteFor.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(`It was not deleted: ${body.error ?? `the server answered ${res.status}`}.`);
        return;
      }
      toast(
        body.outcome === "deactivated"
          ? { title: "Switched off instead of deleted", description: `${body.inspections} inspection${body.inspections === 1 ? "" : "s"} used it, so it is kept for their history.` }
          : { title: "QA template deleted" },
      );
      if (editingId === deleteFor.id) setEditingId(null);
      setDeleteFor(null);
      await reload();
    } finally {
      setDeleting(false);
    }
  }

  const conflicts: QaTemplateConflict[] = findQaTemplateConflicts(templates.map((t) => ({ ...t, serviceType: String(t.serviceType) })));
  const conflictFor = (id: string) => conflicts.find((conflict) => conflict.templateIds.includes(id));
  const nameOf = (id: string) => templates.find((t) => t.id === id);
  const visible = filterAndSortQaTemplates(templates, { jobType: jobTypeFilter, scope: scopeFilter, sort });
  const jobTypesInUse = Array.from(new Set(templates.map((t) => String(t.serviceType)))).sort();
  const editing = editingId ? templates.find((t) => t.id === editingId) ?? null : null;

  function conflictSentence(conflict: QaTemplateConflict): string {
    const named = conflict.templateIds.map((id) => nameOf(id)).filter((row): row is Row => Boolean(row)).map((row) => `"${row.name}" v${row.version}`);
    const scope = conflict.propertyId ? `overrides for ${properties.find((p) => p.id === conflict.propertyId)?.name ?? "a property"}` : "global";
    const winner = conflict.resolvesToId ? nameOf(conflict.resolvesToId)?.name : null;
    return `${named.join(" and ")} are both ${scope} for ${jobTypeLabel(conflict.serviceType as JobType)}. ${
      winner ? `Inspections use "${winner}" (the newest version); the other is marked "Overlaps, not used".` : "Their versions are equal, so either may be used."
    } Switch one off.`;
  }

  function overlapNoteFor(row: Row): string | null {
    const conflict = row.isActive ? conflictFor(row.id) : undefined;
    return conflict ? conflictSentence(conflict) : null;
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 max-w-xl text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Inspection scoring forms per job type. A global template applies everywhere; a property override wins for that property.
        </p>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <ESelect aria-label="Job type" value={jobTypeFilter} onChange={(e) => setJobTypeFilter(e.target.value)} className="h-9 w-auto max-sm:h-11 max-sm:flex-1">
            <option value="all">Job type: all</option>
            {jobTypesInUse.map((type) => <option key={type} value={type}>Job type: {jobTypeLabel(type as JobType)}</option>)}
          </ESelect>
          <ESelect aria-label="Scope" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className="h-9 w-auto max-sm:h-11 max-sm:flex-1">
            <option value="all">Scope: global and property</option>
            <option value="global">Scope: global defaults</option>
            <option value="property">Scope: property overrides</option>
          </ESelect>
          <ESelect aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as QaSort)} className="h-9 w-auto max-sm:h-11 max-sm:flex-1">
            <option value="version">Sort: newest version</option>
            <option value="jobType">Sort: job type</option>
            <option value="scope">Sort: scope</option>
            <option value="name">Sort: name</option>
          </ESelect>
          {canWrite ? (
            <EButton size="sm" onClick={() => setCreateOpen(true)} className="max-sm:w-full">New QA template…</EButton>
          ) : null}
        </div>
      </div>

      {conflicts.length > 0 ? (
        <section aria-labelledby="qa-overlap-heading" className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
          <div className={cn("flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3", toneBandClass("attention"))}>
            <div className="min-w-0 space-y-1">
              <h3 id="qa-overlap-heading" className="text-[0.875rem] font-[600]">
                {conflicts.length === 1 ? "Two active templates share a job type and scope" : `${conflicts.length} job types have active templates that share a scope`}
              </h3>
              {conflicts.map((conflict) => (
                <p key={`${conflict.serviceType}-${conflict.propertyId ?? "global"}`} className="text-[0.8125rem]">{conflictSentence(conflict)}</p>
              ))}
            </div>
            <span className={cn("inline-flex h-5 items-center rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-surface))] px-2 text-[0.6875rem] font-[600]", tonePillClass("attention"))}>Overlap</span>
          </div>
        </section>
      ) : null}

      <ECard className="min-w-0 overflow-hidden p-0">
        {load.status === "loading" && templates.length === 0 ? (
          <div role="status" className="space-y-2 p-4">
            <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Loading QA templates…</span>
            {[0, 1, 2].map((index) => <div key={index} className="h-10 animate-pulse rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))]" />)}
          </div>
        ) : load.status === "failed" && templates.length === 0 ? (
          <div role="alert" className="space-y-2 p-6 text-center text-[0.875rem]">
            <p>{load.error ?? "QA templates could not be loaded. Try again."}</p>
            <EButton size="sm" variant="outline" onClick={() => void reload()}>Try again</EButton>
          </div>
        ) : templates.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No QA templates yet — create one to start scoring inspections.</p>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No QA templates match these filters.</p>
        ) : (
          <>
            {load.status === "failed" ? (
              <p role="alert" className="border-b border-[hsl(var(--e-border))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-danger))]">
                The list could not be refreshed; showing the last one loaded. <button type="button" className="font-[600] underline" onClick={() => void reload()}>Try again</button>
              </p>
            ) : null}
            <div className="overflow-x-auto max-sm:hidden" role="region" aria-label="QA templates" tabIndex={0}>
              <table className="w-full min-w-[58rem] text-left text-[0.8125rem]">
                <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-[550]">Template</th>
                    <th scope="col" className="px-4 py-2 font-[550]">Job type</th>
                    <th scope="col" className="px-4 py-2 font-[550]">Scope</th>
                    <th scope="col" className="px-4 py-2 text-right font-[550]">Version</th>
                    <th scope="col" className="px-4 py-2 text-right font-[550]">Revisions</th>
                    <th scope="col" className="px-4 py-2 font-[550]">Active</th>
                    <th scope="col" className="px-4 py-2 font-[550]">Used by</th>
                    <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--e-border))]">
                  {visible.map((template) => (
                    <QaRow
                      key={template.id}
                      template={template}
                      conflict={template.isActive ? conflictFor(template.id) : undefined}
                      editing={editingId === template.id}
                      canWrite={canWrite}
                      onToggle={() => void toggleActive(template)}
                      onEdit={() => setEditingId(template.id)}
                      onDuplicate={() => void duplicate(template)}
                      onReset={() => { setResetError(null); setResetFor(template); }}
                      onDelete={() => { setDeleteError(null); setDeleteFor(template); }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {/* Phone: one card per template. */}
            <ul className="divide-y divide-[hsl(var(--e-border))] sm:hidden" aria-label="QA templates">
              {visible.map((template) => {
                const conflict = template.isActive ? conflictFor(template.id) : undefined;
                return (
                  <li key={template.id} className={cn("space-y-2 px-4 py-3", conflict && toneRowCellClass("attention"))}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words font-[600]">{template.name}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                          {jobTypeLabel(template.serviceType)} · {template.property ? `Property override, ${template.property.name}` : "Global"} · v{template.version}
                        </p>
                      </div>
                      <ESwitch checked={template.isActive} disabled={!canWrite} onCheckedChange={() => void toggleActive(template)} label={template.isActive ? "On" : "Off"} />
                    </div>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                      {conflict ? (conflict.resolvesToId === template.id ? "In use (overlap)" : "Overlaps, not used") : inspectionWords(template.inspections30d)}
                    </p>
                    <div className="flex gap-2">
                      <EButton size="sm" variant="outline" className="flex-1" onClick={() => setEditingId(template.id)}>{canWrite ? "Edit" : "View"}</EButton>
                      {canWrite ? (
                        <ERowMenu
                          label={`More actions for ${template.name}`}
                          items={[
                            { key: "duplicate", label: "Duplicate", onSelect: () => void duplicate(template) },
                            { key: "reset", label: "Reset to detailed default…", onSelect: () => { setResetError(null); setResetFor(template); } },
                            { key: "delete", label: "Delete…", danger: true, separated: true, onSelect: () => { setDeleteError(null); setDeleteFor(template); } },
                          ]}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-[hsl(var(--e-border))] px-4 py-2.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              {canWrite ? "⋯ holds Duplicate, Reset to detailed default… and Delete…. " : "Only administrators edit QA templates; Edit opens them read only. "}
              &ldquo;Used by&rdquo; counts inspections in the last 30 days; &ldquo;–&rdquo; when it could not be read.
            </p>
          </>
        )}
      </ECard>

      {editing ? (
        <QaTemplateEditor
          key={`${editing.id}:${editing.updatedAt ?? ""}`}
          template={editing}
          revisions={editing.revisions ?? null}
          canWrite={canWrite}
          overlapNote={overlapNoteFor(editing)}
          onClose={() => setEditingId(null)}
          onSaved={(saved, revision) => {
            setTemplates((current) => current.map((row) => (row.id === saved.id ? { ...row, ...saved, revisions: revision ?? row.revisions } : row)));
            if (revision !== null) toast({ title: "QA template saved", description: `Saved as revision ${revision}.` });
          }}
        />
      ) : null}

      <EModal open={createOpen} onClose={() => setCreateOpen(false)} eyebrow="QA templates" title="New QA template">
        <fieldset disabled={creating} className="space-y-4">
          <EField label="Name" hint="Leave blank for an automatic name.">
            <EInput value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Default QA — Airbnb turnover" />
          </EField>
          <EField label="Job type">
            <ESelect value={createType} onChange={(e) => setCreateType(e.target.value as JobType)}>
              {Object.values(JobType).map((type) => <option key={type} value={type}>{jobTypeLabel(type)}</option>)}
            </ESelect>
          </EField>
          <EField label="Property override" hint="Global templates apply everywhere; a property override wins for that property.">
            <ESelect value={createPropertyId} onChange={(e) => setCreatePropertyId(e.target.value)}>
              <option value="__global">Global default</option>
              {properties.map((property) => <option key={property.id} value={property.id}>{property.name} ({property.suburb})</option>)}
            </ESelect>
          </EField>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">The template starts from the detailed default sections for the job type — edit it after creating.</p>
          <EButton className="w-full" onClick={() => void createTemplate()} disabled={creating}>{creating ? "Creating…" : "Create template"}</EButton>
        </fieldset>
      </EModal>

      <EConfirmDialog
        open={Boolean(deleteFor)}
        onClose={() => { if (!deleting) setDeleteFor(null); }}
        tier="destructive"
        title={`Delete ${deleteFor?.name ?? "template"}?`}
        description="If any inspection used it, it is switched off instead so those inspections keep their template. Otherwise it is removed; this cannot be undone."
        confirmLabel="Delete template"
        busy={deleting}
        error={deleteError}
        onConfirm={() => confirmDelete()}
      />
      <EConfirmDialog
        open={Boolean(resetFor)}
        onClose={() => { if (!resetting) setResetFor(null); }}
        tier="ordinary"
        title={`Reset ${resetFor?.name ?? "template"} to the detailed default?`}
        description={`Replace its scoring sections with the latest detailed default for ${resetFor ? jobTypeLabel(resetFor.serviceType) : "the job type"}? Submitted inspections are unaffected.`}
        confirmLabel="Reset to detailed default"
        busy={resetting}
        error={resetError}
        onConfirm={() => confirmReset()}
      />
    </div>
  );
}

function QaRow({
  template,
  conflict,
  editing,
  canWrite,
  onToggle,
  onEdit,
  onDuplicate,
  onReset,
  onDelete,
}: {
  template: Row;
  conflict: QaTemplateConflict | undefined;
  editing: boolean;
  canWrite: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const inUse = conflict?.resolvesToId === template.id;
  const sub = conflict
    ? inUse
      ? "In use"
      : shortDate(template.createdAt) ? `Created ${shortDate(template.createdAt)}` : "Not used"
    : !template.isActive
      ? "Switched off"
      : shortDate(template.updatedAt) ? `changed ${shortDate(template.updatedAt)}` : null;
  return (
    <tr className={cn(editing && "bg-[hsl(var(--e-primary-soft))]")}>
      <th scope="row" className={cn("px-4 py-2.5 text-left font-normal", conflict && toneRowCellClass("attention"))}>
        <span className="block font-[600]">{template.name}</span>
        {sub ? <span className="block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{sub}</span> : null}
      </th>
      <td className="px-4 py-2.5">{jobTypeLabel(template.serviceType)}</td>
      <td className="px-4 py-2.5">
        {template.property ? (
          <span className="space-y-0.5">
            <EPill tone="info">Property override</EPill>
            <span className="block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{template.property.name}</span>
          </span>
        ) : (
          <EPill>Global</EPill>
        )}
      </td>
      <td className="e-tnum px-4 py-2.5 text-right">v{template.version}</td>
      <td className="e-tnum px-4 py-2.5 text-right">{template.revisions === null || template.revisions === undefined ? "–" : template.revisions}</td>
      <td className="px-4 py-2.5">
        <ESwitch checked={template.isActive} disabled={!canWrite} onCheckedChange={onToggle} label={template.isActive ? "On" : "Off"} />
      </td>
      <td className="px-4 py-2.5">
        {conflict ? <EPill tone="warn">{inUse ? "In use (overlap)" : "Overlaps, not used"}</EPill> : inspectionWords(template.inspections30d)}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1.5">
          <EButton size="sm" variant="outline" onClick={onEdit} aria-label={`${canWrite ? "Edit" : "View"} ${template.name}`}>{canWrite ? "Edit" : "View"}</EButton>
          {canWrite ? (
            <ERowMenu
              label={`More actions for ${template.name}`}
              items={[
                { key: "duplicate", label: "Duplicate", onSelect: onDuplicate },
                { key: "reset", label: "Reset to detailed default…", onSelect: onReset },
                { key: "delete", label: "Delete…", danger: true, separated: true, onSelect: onDelete },
              ]}
            />
          ) : null}
        </div>
      </td>
    </tr>
  );
}
