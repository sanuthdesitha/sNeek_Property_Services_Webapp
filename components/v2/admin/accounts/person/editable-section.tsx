"use client";

/**
 * One section of the person panel, edited in place: view → Edit → Save /
 * Cancel. While saving, the fields are frozen. A failed save keeps the draft
 * and shows the server's message, so nothing typed is lost. Moving to a
 * different person resets the section; a save that finishes after that is
 * ignored rather than applied to the new person.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";

export type EditableSectionProps<TDraft> = {
  title: string;
  /** The person this section belongs to; a change resets it. */
  personId: string;
  /** Hide Edit when the viewer cannot save this section. */
  canEdit: boolean;
  view: ReactNode;
  makeDraft: () => TDraft;
  renderEdit: (draft: TDraft, setDraft: (next: TDraft) => void) => ReactNode;
  /** Throws an Error carrying the server's message on failure. */
  save: (draft: TDraft) => Promise<void>;
  /** Called after a successful save for this same person. */
  onSaved?: () => void;
  className?: string;
};

type Mode = "view" | "edit";

export function EditableSection<TDraft>({ title, personId, canEdit, view, makeDraft, renderEdit, save, onSaved, className }: EditableSectionProps<TDraft>) {
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState<TDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPerson = useRef(personId);
  currentPerson.current = personId;

  useEffect(() => {
    setMode("view");
    setDraft(null);
    setSaving(false);
    setError(null);
  }, [personId]);

  function startEdit() {
    setDraft(makeDraft());
    setError(null);
    setMode("edit");
  }

  function cancel() {
    setMode("view");
    setDraft(null);
    setError(null);
  }

  async function submit() {
    if (draft === null) return;
    const forPerson = personId;
    setSaving(true);
    setError(null);
    try {
      await save(draft);
      if (currentPerson.current !== forPerson) return;
      setMode("view");
      setDraft(null);
      onSaved?.();
    } catch (reason) {
      if (currentPerson.current !== forPerson) return;
      setError(reason instanceof Error && reason.message ? reason.message : "Could not save. Your changes are still here.");
    } finally {
      if (currentPerson.current === forPerson) setSaving(false);
    }
  }

  const editing = mode === "edit" && draft !== null;
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-2 rounded-[10px] border px-3 py-2.5",
        editing ? "border-[hsl(var(--e-primary)/0.45)]" : "border-[hsl(var(--e-border))]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[0.65625rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">
          {title}
          {editing ? ", editing" : ""}
        </h3>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <EButton size="sm" variant="ghost" disabled={saving} onClick={cancel}>Cancel</EButton>
            <EButton size="sm" variant="primary" disabled={saving} onClick={submit}>{saving ? "Saving…" : "Save"}</EButton>
          </div>
        ) : canEdit ? (
          <EButton size="sm" variant="ghost" onClick={startEdit} aria-label={`Edit ${title.toLowerCase()}`}>Edit</EButton>
        ) : null}
      </div>
      {editing ? (
        <fieldset disabled={saving} className="flex min-w-0 flex-col gap-2.5">
          {renderEdit(draft as TDraft, (next) => setDraft(next))}
        </fieldset>
      ) : (
        view
      )}
      {editing && error ? (
        <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p>
      ) : null}
    </section>
  );
}

/** The `.dl` definition grid used inside sections. */
export function FactList({ rows, labelWidth = 80 }: { rows: Array<{ label: string; value: ReactNode }>; labelWidth?: number }) {
  return (
    <dl className="m-0 grid gap-x-2.5 gap-y-1.5 text-[0.8125rem]" style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }}>
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-[hsl(var(--e-muted-foreground))]">{row.label}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Reads a JSON error body into an Error with the server's message. */
export async function ensureOk(response: Response, fallback: string): Promise<unknown> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error && body.error !== "FORBIDDEN" ? body.error : response.status === 403 ? "Your account cannot make this change." : fallback);
  return body;
}
