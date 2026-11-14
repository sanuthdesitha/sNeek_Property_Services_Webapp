"use client";

/**
 * Compliance review panel (board "Workforce" › Review): one decision per
 * document without a pop-up. Beside the action list from 1024px; on a phone a
 * full page with one docked button, "Verify and go to next" (board
 * M-Workforce › Review a document).
 *
 * Saves through the existing REVIEW_DOCUMENT action. Reject needs a reason the
 * person will see (the server refuses it without one). The expiry date is
 * read from the file by the reviewer, never guessed. Fields freeze while
 * saving; a failed save keeps the decision and the note.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import type { ComplianceLibraryDoc } from "@/lib/workforce/compliance-load";
import { calendarDay, instant } from "./compliance-format";
import { prettify } from "./utils";

export type ReviewDecision = "VERIFIED" | "REJECTED" | "PENDING" | "EXPIRED";

const DECISIONS: Array<{ value: ReviewDecision; label: string; action: string }> = [
  { value: "VERIFIED", label: "Verify", action: "Verify document" },
  { value: "REJECTED", label: "Reject", action: "Reject document" },
  { value: "PENDING", label: "Keep waiting", action: "Keep waiting" },
  { value: "EXPIRED", label: "Mark expired", action: "Mark expired" },
];

const INPUT =
  "mt-1 h-11 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:text-[0.875rem] disabled:opacity-60";

export function ComplianceReview({
  doc,
  position,
  timeZone,
  readOnlyReason,
  phone,
  onSaved,
  onNext,
  onClose,
}: {
  doc: ComplianceLibraryDoc;
  /** 1-based place in the waiting list, or null when the document is not waiting. */
  position: { index: number; total: number } | null;
  timeZone: string;
  readOnlyReason: string | null;
  phone: boolean;
  onSaved: (goToNext: boolean) => void;
  onNext: (() => void) | null;
  onClose: () => void;
}) {
  const id = React.useId();
  const [decision, setDecision] = React.useState<ReviewDecision>(doc.status === "PENDING" ? "VERIFIED" : (["VERIFIED", "REJECTED", "EXPIRED"].includes(doc.status) ? (doc.status as ReviewDecision) : "VERIFIED"));
  const [expiry, setExpiry] = React.useState(doc.expiresAt ? doc.expiresAt.slice(0, 10) : "");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, [doc.id]);

  const action = DECISIONS.find((option) => option.value === decision)?.action ?? "Save";
  const reasonMissing = decision === "REJECTED" && !note.trim();

  async function save(goToNext: boolean) {
    if (reasonMissing) {
      setError(`Say why it is rejected; ${doc.user.name} sees this reason.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/workforce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REVIEW_DOCUMENT",
          documentId: doc.id,
          status: decision,
          notes: note.trim() || doc.notes || null,
          expiresAt: expiry || null,
          requiresSignature: doc.requiresSignature,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(`Not saved: ${typeof body?.error === "string" ? body.error : "try again."} Your decision and note are kept.`);
        return;
      }
      onSaved(goToNext);
    } catch {
      setError("Not saved: the connection failed. Your decision and note are kept.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
        phone ? "pb-24" : "p-4 lg:sticky lg:top-4",
      )}
    >
      {phone ? (
        <div className="flex items-center gap-2 border-b border-[hsl(var(--e-border))] p-3">
          <button type="button" onClick={onClose} aria-label="Back to the list" className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 ref={titleRef} tabIndex={-1} id={`${id}-title`} className="truncate text-[0.9375rem] font-semibold outline-none">{doc.title}</h2>
            <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{doc.user.name}{position ? ` · ${position.index} of ${position.total} to review` : ""}</p>
          </div>
          {onNext ? (
            <button type="button" onClick={onNext} aria-label="Next to review" className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">Review · {doc.user.name}</p>
            <h2 ref={titleRef} tabIndex={-1} id={`${id}-title`} className="text-[1.125rem] font-semibold outline-none [overflow-wrap:anywhere]">{doc.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close the review" className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--e-radius)] hover:bg-[hsl(var(--e-muted)/0.5)]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className={cn("space-y-3", phone && "p-3")}>
        <div className="flex items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
          <span className="min-w-0 truncate">{doc.fileName}</span>
          <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-[550] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            Open file <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>
        </div>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
          {prettify(doc.category)} · uploaded{doc.uploadedByName ? ` by ${doc.uploadedByName}` : ""} {instant(doc.createdAt, timeZone)}
          {doc.requiresSignature ? " · needs their signature" : ""}
          {doc.expiresAt ? ` · expiry on file ${calendarDay(doc.expiresAt)}` : ""}
          {doc.notes ? ` · note: ${doc.notes}` : ""}
        </p>

        <fieldset disabled={saving || Boolean(readOnlyReason)} className="space-y-3">
          <legend className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">Decision</legend>
          <div role="radiogroup" aria-label="Decision" className="flex flex-wrap gap-1.5">
            {DECISIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={decision === option.value}
                onClick={() => { setDecision(option.value); setError(null); }}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-[0.8125rem] max-sm:min-h-11 disabled:opacity-60",
                  decision === option.value
                    ? "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]"
                    : "border-[hsl(var(--e-border-strong))]",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor={`${id}-expiry`} className="block text-[0.8125rem] font-[550]">Expiry date</label>
            <input id={`${id}-expiry`} type="date" className={INPUT} value={expiry} onChange={(event) => setExpiry(event.target.value)} aria-describedby={`${id}-expiry-hint`} />
            <p id={`${id}-expiry-hint`} className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Read from the file by you, not guessed. Leave empty only if it never expires.</p>
          </div>
          <div>
            <label htmlFor={`${id}-note`} className="block text-[0.8125rem] font-[550]">{decision === "REJECTED" ? `Reason ${doc.user.name} will see` : "Note for the record, optional"}</label>
            <input id={`${id}-note`} className={INPUT} value={note} placeholder={decision === "REJECTED" ? "e.g. The photo is cut off; please upload all pages" : "e.g. Policy number checked against insurer"} onChange={(event) => setNote(event.target.value)} />
          </div>
          {error ? <p role="alert" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
          {readOnlyReason ? <p className="text-[0.8125rem]">{readOnlyReason}</p> : null}

          {phone ? (
            <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-30 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
              <EButton className="w-full" size="lg" onClick={() => void save(true)} disabled={saving || Boolean(readOnlyReason)}>
                {saving ? "Saving…" : decision === "VERIFIED" ? "Verify and go to next" : `${action} and go to next`}
              </EButton>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <EButton size="sm" onClick={() => void save(false)}>{saving ? "Saving…" : action}</EButton>
              {onNext ? <EButton size="sm" variant="outline" onClick={onNext}>Next to review ›</EButton> : null}
            </div>
          )}
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Reject asks for a reason they will see; ask for a new upload with &ldquo;Request a document…&rdquo;. Rejected and replaced files stay in their history.</p>
        </fieldset>
      </div>
    </section>
  );
}
