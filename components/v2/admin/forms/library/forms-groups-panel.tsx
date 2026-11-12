"use client";

/**
 * Left panel of the Job forms tab: All forms, each group with its count
 * (+ New, rename, delete for admins), Tags, Drafts and Archived. Choosing an
 * entry filters the table; the choice lives in the URL with the other filters.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EConfirmModal, EInput } from "@/components/v2/admin/estate-kit";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import type { FormGroupSummary, FormLibraryCounts, FormLibraryScope } from "@/lib/forms/library-types";
import { useGroupEditing } from "./use-group-editing";

export type GroupsPanelProps = {
  groups: FormGroupSummary[];
  groupsError: string | null;
  counts: FormLibraryCounts | null;
  scope: FormLibraryScope;
  group: string;
  tag: string;
  canWrite: boolean;
  onSelect: (patch: { scope: FormLibraryScope; group: string }) => void;
  onTag: (tag: string) => void;
  onGroupsChanged: () => void;
};

function Fold({ active, label, count, onClick }: { active: boolean; label: string; count?: number | null; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-[2rem] w-full min-w-0 items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[0.8125rem] font-[500] text-[hsl(var(--e-text-secondary))]",
        "hover:bg-[hsl(var(--e-surface-raised))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
        active && "bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))] hover:bg-[hsl(var(--e-primary-soft))]",
      )}
    >
      <span className="truncate">{label}</span>
      {typeof count === "number" ? <span className="e-tnum shrink-0">{count}</span> : null}
    </button>
  );
}

function NameForm({ initial, label, busy, onSave, onCancel }: { initial: string; label: string; busy: boolean; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = React.useState(initial);
  const id = React.useId();
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(name);
      }}
    >
      <label htmlFor={id} className="sr-only">{label}</label>
      <EInput id={id} autoFocus value={name} disabled={busy} maxLength={60} onChange={(e) => setName(e.target.value)} className="h-8 text-[0.8125rem]" />
      <div className="flex gap-1.5">
        <EButton type="submit" size="sm" className="h-7 px-2.5 text-[0.75rem]" disabled={busy || !name.trim()}>Save</EButton>
        <EButton type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-[0.75rem]" disabled={busy} onClick={onCancel}>Cancel</EButton>
      </div>
    </form>
  );
}

export function FormsGroupsPanel(props: GroupsPanelProps) {
  const { groups, counts, scope, group, tag, canWrite, onSelect, onTag } = props;
  const editing = useGroupEditing(props.onGroupsChanged, (deletedId) => {
    if (group === deletedId) onSelect({ scope: "active", group: "" });
  });
  const tags = counts?.tags ?? [];

  return (
    <section aria-label="Groups" className="flex w-full flex-none flex-col gap-1 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3.5 lg:w-[210px]">
      <div className="flex items-center justify-between">
        <EEyebrow>Groups</EEyebrow>
        {canWrite ? (
          <EButton size="sm" variant="ghost" className="h-7 px-2 text-[0.75rem]" onClick={editing.startCreate} disabled={editing.mode !== null}>
            + New
          </EButton>
        ) : null}
      </div>
      {editing.mode?.kind === "create" ? (
        <NameForm initial="" label="New group name" busy={editing.busy} onSave={editing.create} onCancel={editing.cancel} />
      ) : null}
      <Fold active={scope === "active" && group === ""} label="All forms" count={counts?.active} onClick={() => onSelect({ scope: "active", group: "" })} />
      {groups.map((item) =>
        editing.mode?.kind === "rename" && editing.mode.group.id === item.id ? (
          <NameForm key={item.id} initial={item.name} label={`Rename ${item.name}`} busy={editing.busy} onSave={editing.rename} onCancel={editing.cancel} />
        ) : (
          <div key={item.id} className="flex items-center gap-1">
            <Fold active={scope === "active" && group === item.id} label={item.name} count={counts?.byGroup[item.id] ?? item.formCount} onClick={() => onSelect({ scope: "active", group: item.id })} />
            {canWrite ? (
              <ERowMenu
                label={`Group actions for ${item.name}`}
                items={[
                  { key: "rename", label: "Rename", onSelect: () => editing.startRename(item) },
                  { key: "delete", label: "Delete group…", danger: true, onSelect: () => editing.askDelete(item) },
                ]}
              />
            ) : null}
          </div>
        ),
      )}
      {props.groupsError ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{props.groupsError}</p> : null}
      {editing.error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{editing.error}</p> : null}
      <div className="my-1.5 h-px bg-[hsl(var(--e-border))]" />
      <EEyebrow>Tags</EEyebrow>
      {tags.length === 0 ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No tags yet. Select forms and use Tags.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((entry) => (
            <button
              key={entry.tag}
              type="button"
              aria-pressed={tag === entry.tag}
              onClick={() => onTag(tag === entry.tag ? "" : entry.tag)}
              className={cn(
                "inline-flex h-5 items-center rounded-[var(--e-radius-pill)] px-2 text-[0.6875rem] font-[600]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                tag === entry.tag
                  ? "bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]"
                  : "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-text-secondary))]",
              )}
            >
              {entry.tag}
            </button>
          ))}
        </div>
      )}
      <div className="my-1.5 h-px bg-[hsl(var(--e-border))]" />
      <Fold active={scope === "drafts"} label="Drafts" count={counts?.drafts} onClick={() => onSelect({ scope: "drafts", group: "" })} />
      <Fold active={scope === "archived"} label="Archived" count={counts?.archived} onClick={() => onSelect({ scope: "archived", group: "" })} />
      <EConfirmModal
        open={Boolean(editing.deleteTarget)}
        onClose={editing.cancelDelete}
        title="Delete group"
        description={editing.deleteTarget ? `“${editing.deleteTarget.name}” is removed. Its forms stay, ungrouped; nothing else changes.` : undefined}
        confirmLabel="Delete group"
        loading={editing.busy}
        onConfirm={() => void editing.confirmDelete()}
      />
    </section>
  );
}
