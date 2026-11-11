"use client";

/**
 * The form name in the builder header, editable in place. It stays the page's
 * one h1 in both states: reading shows the name and a "Rename form" button
 * (or click the name); editing puts a labelled text box inside the same h1.
 * Enter or leaving the box saves, Escape cancels. While saving the box is
 * frozen; a refused save (e.g. changed elsewhere) keeps the typed name and
 * says why.
 */
import * as React from "react";
import { Pencil } from "lucide-react";

export type RenameOutcome = { ok: true } | { ok: false; error: string };

export function InlineFormName({
  name,
  disabled,
  onRename,
  children,
}: {
  name: string;
  disabled?: boolean;
  onRename: (next: string) => Promise<RenameOutcome>;
  /** The state pill, kept inside the h1 as drawn. */
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(name);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);
  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const start = () => {
    if (disabled) return;
    setError(null);
    setDraft(name);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError(null);
    setDraft(name);
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  };
  const commit = async () => {
    if (saving) return;
    const next = draft.trim();
    if (next === name.trim()) return cancel();
    if (!next) {
      setError("A form needs a name.");
      return;
    }
    setSaving(true);
    const outcome = await onRename(next);
    setSaving(false);
    if (outcome.ok) {
      setEditing(false);
      setError(null);
      window.setTimeout(() => buttonRef.current?.focus(), 0);
    } else {
      setError(outcome.error);
    }
  };

  return (
    <>
      <h1 className="e-display-md mt-1 break-words">
        {editing ? (
          <input
            ref={inputRef}
            aria-label="Form name"
            value={draft}
            maxLength={100}
            readOnly={saving}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "form-name-error" : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
            onBlur={() => void commit()}
            className="w-full max-w-[36rem] rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] px-2 py-0.5 font-[inherit] text-[length:inherit] text-[hsl(var(--e-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--e-ring))]"
          />
        ) : (
          <>
            <span onClick={start} className={disabled ? undefined : "cursor-text"}>
              {name || "Untitled form"}
            </span>{" "}
            <button
              ref={buttonRef}
              type="button"
              onClick={start}
              disabled={disabled}
              aria-label="Rename form"
              title="Rename form"
              className="inline-flex size-7 items-center justify-center rounded-[var(--e-radius-sm)] align-middle text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))] disabled:opacity-40"
            >
              <Pencil className="size-4" aria-hidden />
            </button>{" "}
          </>
        )}
        {children}
      </h1>
      {saving ? <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]" aria-live="polite">Saving the name…</p> : null}
      {error ? (
        <p id="form-name-error" role="alert" className="text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">
          {error}
        </p>
      ) : null}
    </>
  );
}
