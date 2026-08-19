"use client";

/**
 * Saved job templates for the ESTATE job builder. Talks to the SAME
 * /api/admin/job-templates endpoints as the classic builder (one shared JSON
 * store), so templates created in either builder show up in both. The parent
 * form owns all job state: it hands us a snapshot() to serialize when saving
 * and receives the raw template back on apply — this panel never interprets
 * job fields itself, which keeps the template shape decoupled from either
 * form's internal state.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ESelect,
} from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";
import type { JobReferenceAttachment, JobTimingPreset } from "@/lib/jobs/meta";

/** Timing rule as the templates API stores it ({enabled,preset,time}). */
export type TemplateTimingRule = {
  enabled?: boolean;
  preset?: JobTimingPreset;
  time?: string;
};

/** A template row as returned by GET /api/admin/job-templates. */
export type JobTemplate = {
  id: string;
  name: string;
  jobType: string;
  startTime?: string;
  dueTime?: string;
  endTime?: string;
  estimatedHours?: number;
  notes?: string;
  internalNotes?: string;
  isDraft?: boolean;
  tags?: string[];
  attachments?: JobReferenceAttachment[];
  earlyCheckin?: TemplateTimingRule;
  lateCheckout?: TemplateTimingRule;
};

/** What the parent form exposes for "save current form as template". */
export type TemplateSnapshot = {
  jobType: string;
  startTime: string;
  dueTime: string;
  endTime: string;
  estimatedHours: string;
  notes: string;
  internalNotes: string;
  isDraft: boolean;
  tags: string[];
  attachments: JobReferenceAttachment[];
  earlyCheckin: TemplateTimingRule;
  lateCheckout: TemplateTimingRule;
};

interface JobTemplatesPanelProps {
  snapshot: () => TemplateSnapshot;
  onApply: (template: JobTemplate) => void;
}

export function JobTemplatesPanel({ snapshot, onApply }: JobTemplatesPanelProps) {
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/job-templates", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  function applySelected() {
    if (!selected) return;
    onApply(selected);
    toast({ title: `Template applied: ${selected.name}` });
  }

  // POST leaves empty optionals undefined (nothing to store); PATCH sends null
  // so the server explicitly CLEARS values the form no longer has — otherwise
  // an update could never remove a previously-saved time or note.
  function buildPayload(mode: "new" | "update", name: string) {
    const s = snapshot();
    const empty = mode === "new" ? undefined : null;
    return {
      name,
      jobType: s.jobType,
      startTime: s.startTime || empty,
      dueTime: s.dueTime || empty,
      endTime: s.endTime || empty,
      estimatedHours: s.estimatedHours ? Number(s.estimatedHours) : empty,
      notes: s.notes || empty,
      internalNotes: s.internalNotes || empty,
      isDraft: s.isDraft,
      tags: s.tags,
      attachments: s.attachments,
      earlyCheckin: s.earlyCheckin,
      lateCheckout: s.lateCheckout,
    };
  }

  async function saveTemplate(mode: "new" | "update") {
    const name = nameDraft.trim();
    if (!name) {
      toast({ title: "Template name is required.", variant: "destructive" });
      return;
    }
    if (mode === "update" && !selected) return;
    setBusy(true);
    try {
      const res = await fetch(
        mode === "new" ? "/api/admin/job-templates" : `/api/admin/job-templates/${selected!.id}`,
        {
          method: mode === "new" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(mode, name)),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to save template.");
      if (mode === "new") {
        setTemplates((prev) => [body, ...prev]);
        setSelectedId(body.id);
        setSaveOpen(false);
      } else {
        setTemplates((prev) => prev.map((row) => (row.id === selected!.id ? { ...row, ...body } : row)));
        setUpdateOpen(false);
      }
      toast({ title: mode === "new" ? "Template saved" : "Template updated" });
    } catch (err: unknown) {
      toast({
        title: "Template failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/job-templates/${selected.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to delete template.");
      setTemplates((prev) => prev.filter((row) => row.id !== selected.id));
      setSelectedId("");
      setDeleteOpen(false);
      toast({ title: "Template deleted" });
    } catch (err: unknown) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <ESelect value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">{templates.length ? "Select a saved template" : "No saved templates yet"}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.jobType.replace(/_/g, " ")})
            </option>
          ))}
        </ESelect>
        <EButton type="button" variant="outline" disabled={!selected} onClick={applySelected}>
          Apply
        </EButton>
      </div>

      <div className="flex flex-wrap gap-2">
        <EButton
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setNameDraft("");
            setSaveOpen(true);
          }}
        >
          Save form as template
        </EButton>
        <EButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={!selected}
          onClick={() => {
            // Prefill the current name so a pure "overwrite values" update
            // doesn't force retyping it.
            setNameDraft(selected?.name ?? "");
            setUpdateOpen(true);
          }}
        >
          Rename / update
        </EButton>
        <EButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={!selected}
          className="text-[hsl(var(--e-danger))]"
          onClick={() => setDeleteOpen(true)}
        >
          Delete
        </EButton>
      </div>

      <EModal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save as template" eyebrow="Templates">
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            Stores the current job type, times, pay hours, notes, tags, turnaround flags, and reference files.
            Property, dates, and assignees are per-job and are not saved.
          </p>
          <EField label="Template name">
            <EInput
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="e.g. Standard turnover — 2BR"
              autoFocus
            />
          </EField>
          <div className="flex justify-end gap-2 pt-1">
            <EButton type="button" variant="outline" size="sm" onClick={() => setSaveOpen(false)} disabled={busy}>
              Cancel
            </EButton>
            <EButton type="button" size="sm" disabled={busy || !nameDraft.trim()} onClick={() => saveTemplate("new")}>
              {busy ? "Saving…" : "Save template"}
            </EButton>
          </div>
        </div>
      </EModal>

      <EModal open={updateOpen} onClose={() => setUpdateOpen(false)} title="Update template" eyebrow="Templates">
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            Overwrites <span className="font-[550]">{selected?.name ?? "the selected template"}</span> with the
            current form values. Change the name below to rename it at the same time.
          </p>
          <EField label="Template name">
            <EInput value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
          </EField>
          <div className="flex justify-end gap-2 pt-1">
            <EButton type="button" variant="outline" size="sm" onClick={() => setUpdateOpen(false)} disabled={busy}>
              Cancel
            </EButton>
            <EButton type="button" size="sm" disabled={busy || !nameDraft.trim()} onClick={() => saveTemplate("update")}>
              {busy ? "Updating…" : "Update template"}
            </EButton>
          </div>
        </div>
      </EModal>

      <EConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete "${selected?.name ?? "template"}"?`}
        description="Removes this saved template for everyone. Jobs already created from it are unaffected."
        confirmLabel="Delete template"
        loading={busy}
        onConfirm={deleteSelected}
      />
    </div>
  );
}
