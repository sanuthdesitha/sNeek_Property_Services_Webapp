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
  NOTICE: "Notice",
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
    {/* A CARD, not a takeover.

        This filled the whole screen, which made a two-line note about a bin
        day look like a system-wide alert and buried the job the cleaner was
        trying to start. It is now a small centred card over a blurred
        backdrop: the job stays visible behind it, so the reader keeps their
        place, and the weight of the interruption matches the weight of what
        it is interrupting for. */}
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[hsl(var(--e-backdrop,220_20%_8%)/0.55)] backdrop-blur-sm" aria-hidden />
      <div
        className="relative flex max-h-[80dvh] w-full max-w-[26rem] flex-col overflow-hidden rounded-[var(--e-radius-lg,1rem)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-3,0_24px_48px_-12px_rgb(0_0_0/0.45))]"
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

        {item.images && item.images.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {item.images.map((src, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={`${src}-${i}`}
                src={src}
                alt={`Reference ${i + 1} for ${item.title}`}
                className="h-28 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] object-cover"
                loading="lazy"
              />
            ))}
          </div>
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
    </div>
    </EstatePortal>
  );
}
