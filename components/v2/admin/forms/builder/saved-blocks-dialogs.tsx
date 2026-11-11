"use client";

/**
 * Saved blocks: "Save as block" stores copies of the selected questions;
 * "Insert saved block…" adds copies of a block's questions (fresh ids) to the
 * selected section. Storage: AppSetting `formBuilder.savedBlocks`
 * (lib/forms/saved-blocks.ts), shared by every admin.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal } from "@/components/v2/admin/estate-kit";
import type { FormField } from "@/lib/forms/types";

type Block = { id: string; name: string; questionCount: number; fields: FormField[]; createdAt: string };

export function SaveBlockDialog({ open, onClose, fields }: { open: boolean; onClose: () => void; fields: FormField[] }) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    setSaved(false);
  }, [open]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/form-templates/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, fields }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Could not save the block (${response.status}).`);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the block.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EModal open={open} onClose={onClose} title="Save as block" eyebrow={`${fields.length} question${fields.length === 1 ? "" : "s"}`}>
      {saved ? (
        <div className="space-y-3">
          <p role="status" className="text-[0.8125rem]">Saved. Use “Insert saved block…” in any form to add these questions.</p>
          <div className="flex justify-end"><EButton size="sm" onClick={onClose}>Done</EButton></div>
        </div>
      ) : (
        <fieldset disabled={busy} className="space-y-3">
          <EField label="Block name">
            <EInput value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="e.g. Oven deep-clean checks" />
          </EField>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Show/hide rules that watch questions outside the block are left out of it.</p>
          {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" type="button" onClick={onClose}>Cancel</EButton>
            <EButton size="sm" type="button" disabled={!name.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save block"}</EButton>
          </div>
        </fieldset>
      )}
    </EModal>
  );
}

export function InsertBlockDialog({
  open,
  onClose,
  sectionTitle,
  canDelete,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  sectionTitle: string;
  canDelete: boolean;
  onInsert: (fields: FormField[]) => void;
}) {
  const [blocks, setBlocks] = React.useState<Block[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback((signal?: AbortSignal) => {
    setError(null);
    fetch("/api/admin/form-templates/blocks", { cache: "no-store", signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (signal?.aborted) return;
        if (!response.ok) throw new Error(body.error ?? "Could not load saved blocks.");
        setBlocks(Array.isArray(body.blocks) ? body.blocks : []);
      })
      .catch((err: unknown) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : "Could not load saved blocks.");
      });
  }, []);
  React.useEffect(() => {
    if (!open) return;
    setBlocks(null);
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [open, load]);

  async function remove(id: string) {
    const response = await fetch(`/api/admin/form-templates/blocks/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not delete the block.");
      return;
    }
    load();
  }

  return (
    <EModal open={open} onClose={onClose} title="Insert saved block" eyebrow={`Into “${sectionTitle}”`}>
      {error ? <p role="alert" className="mb-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {blocks === null && !error ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Loading saved blocks…</p> : null}
      {blocks && blocks.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">No saved blocks yet. Select questions and choose “Save as block”.</p>
      ) : null}
      <ul className="space-y-1.5">
        {(blocks ?? []).map((block) => (
          <li key={block.id} className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[hsl(var(--e-border))] px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[0.8125rem] font-[600]">{block.name}</span>
              <span className="block text-[0.75rem] text-[hsl(var(--e-text-faint))]">{block.questionCount} question{block.questionCount === 1 ? "" : "s"}: {block.fields.slice(0, 3).map((f) => f.label).join(", ")}{block.fields.length > 3 ? "…" : ""}</span>
            </span>
            <EButton size="sm" onClick={() => { onInsert(block.fields); onClose(); }}>Insert</EButton>
            {canDelete ? <EButton size="sm" variant="ghost" onClick={() => void remove(block.id)}>Delete</EButton> : null}
          </li>
        ))}
      </ul>
    </EModal>
  );
}

export function MoveToSectionDialog({
  open,
  onClose,
  sections,
  currentSectionId,
  count,
  onMove,
}: {
  open: boolean;
  onClose: () => void;
  sections: Array<{ id: string; title: string }>;
  currentSectionId: string | null;
  count: number;
  onMove: (sectionId: string) => void;
}) {
  return (
    <EModal open={open} onClose={onClose} title={`Move ${count} question${count === 1 ? "" : "s"} to…`}>
      <ul className="space-y-1">
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              disabled={section.id === currentSectionId}
              onClick={() => { onMove(section.id); onClose(); }}
              className="w-full rounded-[8px] border border-[hsl(var(--e-border))] px-3 py-2 text-left text-[0.8125rem] hover:bg-[hsl(var(--e-muted))] disabled:opacity-50"
            >
              {section.title || "Untitled section"}
              {section.id === currentSectionId ? " (current)" : ""}
            </button>
          </li>
        ))}
      </ul>
    </EModal>
  );
}
