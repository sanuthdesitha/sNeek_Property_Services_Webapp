"use client";

/**
 * START BRIEFING dialog (R2) — a full-screen sheet shown when the cleaner taps
 * clock-in on a job that carries things they must have READ first.
 *
 * Same shape as the final-checkup dialog it is cloned from: items are walked
 * SEQUENTIALLY with a "3 / 7" counter, one Acknowledge button per item, back
 * allowed, and deliberately NO skip and NO select-all — a single "I agree to
 * all of the above" is how people stop reading.
 *
 * The difference is the moment. Final check-up asks "did you do it?" at submit;
 * this asks "do you know about it?" at start, which is the only point where the
 * answer can still change what happens.
 */
import * as React from "react";
import { EstatePortal } from "@/components/v2/ui/portal-root";
import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, X } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import type {
  ResolvedStartBriefingItem,
  StartBriefingAckEntry,
  StartBriefingSource,
} from "@/lib/forms/start-briefing";

const SOURCE_LABEL: Record<StartBriefingSource, string> = {
  TIMING_RULE: "Timing rule",
  ADMIN_TASK: "Admin task",
  CLIENT_TASK: "Client request",
  SPECIAL_NOTE: "Note",
};

export function StartBriefingDialog({
  open,
  items,
  stale,
  onClose,
  onComplete,
}: {
  open: boolean;
  items: ResolvedStartBriefingItem[];
  /** The items changed since a previous acknowledgement — say so. */
  stale?: boolean;
  /** Dismiss without starting (the cleaner backed out). */
  onClose: () => void;
  /** Every item acknowledged — resolves with the ack entries in item order. */
  onComplete: (ack: StartBriefingAckEntry[]) => void;
}) {
  const [index, setIndex] = React.useState(0);
  const [acks, setAcks] = React.useState<Record<string, string>>({});

  // Reset the walk whenever the dialog (re)opens or the item list changes.
  React.useEffect(() => {
    if (open) {
      setIndex(0);
      setAcks({});
    }
  }, [open, items]);

  if (!open || items.length === 0 || typeof document === "undefined") return null;

  const item = items[Math.min(index, items.length - 1)];
  const isLast = index >= items.length - 1;
  const isTiming = item.source === "TIMING_RULE";

  function acknowledgeCurrent() {
    const at = acks[item.id] ?? new Date().toISOString();
    const nextAcks = { ...acks, [item.id]: at };
    setAcks(nextAcks);
    if (!isLast) {
      setIndex((i) => i + 1);
      return;
    }
    onComplete(
      items.map((it) => ({ itemId: it.id, at: nextAcks[it.id] ?? new Date().toISOString() }))
    );
  }

  return (
    <EstatePortal>
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-[hsl(var(--e-surface))]"
      role="dialog"
      aria-modal="true"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-4 py-3.5">
        <p className="e-eyebrow flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 text-[hsl(var(--e-gold))]" /> Before you start
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[0.8125rem] font-[600] tabular-nums text-[hsl(var(--e-text-secondary))]">
            {Math.min(index + 1, items.length)} / {items.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {stale ? (
        <p className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-warning-soft))] px-4 py-2.5 text-[0.8125rem]">
          These instructions changed since you last read them.
        </p>
      ) : null}

      {/* Item */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <p className="text-[0.6875rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
          {SOURCE_LABEL[item.source]}
        </p>
        <p
          className={
            "mt-2 flex items-start gap-2 text-[1.25rem] font-[600] leading-snug " +
            (isTiming ? "text-[hsl(var(--e-danger))]" : "")
          }
        >
          {isTiming ? <AlertTriangle className="mt-1 h-5 w-5 shrink-0" /> : null}
          <span>{item.title}</span>
        </p>
        {item.detail ? (
          <p className="mt-3 whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
            {item.detail}
          </p>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-[hsl(var(--e-border))] px-4 py-3.5 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]">
        {index > 0 ? (
          <EButton variant="outline" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            <ArrowLeft className="h-4 w-4" /> Back
          </EButton>
        ) : null}
        <EButton variant="gold" className="flex-1" onClick={acknowledgeCurrent}>
          <CheckCircle2 className="h-4 w-4" />
          {isLast ? "I've read this — start the job" : "I've read this"}
        </EButton>
      </div>
    </div>
    </EstatePortal>
  );
}
