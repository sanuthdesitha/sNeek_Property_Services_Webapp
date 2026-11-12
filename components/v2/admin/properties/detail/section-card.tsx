"use client";

/**
 * A property page section with its own Edit: the card shows the saved values;
 * Edit turns it into a small form with Save and Cancel. While saving the
 * fields are frozen; a failed save keeps the draft and says why; Cancel drops
 * the draft. The draft starts from the saved values each time Edit is pressed.
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import type { SaveResult } from "./use-property-record";

export const EYEBROW_CLASS = "text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]";

export function CardHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className={EYEBROW_CLASS}>{title}</h2>
      {action}
    </div>
  );
}

export function SectionCard<TDraft>({
  title,
  editLabel = "Edit",
  className,
  view,
  initialDraft,
  form,
  onSave,
  savedMessage,
  canEdit = true,
}: {
  title: string;
  editLabel?: string;
  className?: string;
  view: React.ReactNode;
  initialDraft: () => TDraft;
  form: (draft: TDraft, setDraft: (patch: Partial<TDraft>) => void) => React.ReactNode;
  onSave: (draft: TDraft) => Promise<SaveResult>;
  savedMessage?: string;
  canEdit?: boolean;
}) {
  const [draft, setDraftState] = useState<TDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setDraft(patch: Partial<TDraft>) {
    setDraftState((current) => (current ? { ...current, ...patch } : current));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast({ title: savedMessage ?? `${title} saved` });
    setDraftState(null);
  }

  return (
    <ECard className={"flex min-w-0 flex-col gap-3 p-4 " + (className ?? "")}>
      <CardHead
        title={title}
        action={
          draft === null && canEdit ? (
            <EButton size="sm" variant="ghost" onClick={() => setDraftState(initialDraft())}>{editLabel}</EButton>
          ) : null
        }
      />
      {draft === null ? (
        view
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={saving} className="flex min-w-0 flex-col gap-3">
            {form(draft, setDraft)}
          </fieldset>
          {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <EButton type="button" size="sm" variant="outline" disabled={saving} onClick={() => { setDraftState(null); setError(null); }}>Cancel</EButton>
            <EButton type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save"}</EButton>
          </div>
        </form>
      )}
    </ECard>
  );
}

/** Term / value rows (the drawn `.kv`). */
export function KeyValues({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-[0.8125rem]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-[hsl(var(--e-muted-foreground))]">{children}</span>;
}
