"use client";

/**
 * Final check-up acknowledgement dialog (R7) — a full-screen sheet shown when
 * the cleaner taps "Submit & clock out" and the job has resolved check-up
 * items. Items are walked SEQUENTIALLY (progress "3 / 7"): each shows its
 * title, optional detail, and any admin reference images (S3 keys resolved via
 * /api/uploads/access; tap to enlarge). One "Acknowledge" button per item —
 * back is allowed, but there is deliberately NO skip and NO select-all.
 * Completing the last item resolves with [{ itemId, at: ISO }] for every item.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, X } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import type {
  FinalCheckupAckEntry,
  ResolvedFinalCheckupItem,
} from "@/lib/forms/final-checkup";

function ReferenceImage({ storageKey, onOpen }: { storageKey: string; onOpen: (url: string) => void }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    fetch(`/api/uploads/access?key=${encodeURIComponent(storageKey)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("access failed"))))
      .then((body) => {
        if (cancelled) return;
        if (body?.url) setUrl(body.url as string);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  if (failed) return null;
  if (!url) {
    return (
      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]">
        <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--e-text-faint))]" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      className="h-24 w-24 shrink-0 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]"
      aria-label="Enlarge reference image"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Reference" className="h-full w-full object-cover" />
    </button>
  );
}

export function FinalCheckupDialog({
  open,
  items,
  onClose,
  onComplete,
}: {
  open: boolean;
  items: ResolvedFinalCheckupItem[];
  /** Dismiss without submitting (the cleaner backed out). */
  onClose: () => void;
  /** Every item acknowledged — resolves with the ack entries in item order. */
  onComplete: (ack: FinalCheckupAckEntry[]) => void;
}) {
  const [index, setIndex] = React.useState(0);
  const [acks, setAcks] = React.useState<Record<string, string>>({});
  const [enlarged, setEnlarged] = React.useState<string | null>(null);

  // Reset the walk whenever the dialog (re)opens or the item list changes.
  React.useEffect(() => {
    if (open) {
      setIndex(0);
      setAcks({});
      setEnlarged(null);
    }
  }, [open, items]);

  if (!open || items.length === 0 || typeof document === "undefined") return null;

  const item = items[Math.min(index, items.length - 1)];
  const isLast = index >= items.length - 1;

  function acknowledgeCurrent() {
    const at = acks[item.id] ?? new Date().toISOString();
    const nextAcks = { ...acks, [item.id]: at };
    setAcks(nextAcks);
    if (!isLast) {
      setIndex((i) => i + 1);
      return;
    }
    // Every item must carry an ack — earlier ones were recorded on the way through.
    onComplete(items.map((it) => ({ itemId: it.id, at: nextAcks[it.id] ?? new Date().toISOString() })));
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[hsl(var(--e-surface))]" role="dialog" aria-modal="true">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-4 py-3.5">
        <p className="e-eyebrow flex items-center gap-1.5">
          <ClipboardCheck className="h-4 w-4 text-[hsl(var(--e-gold))]" /> Final check-up
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

      {/* Progress bar */}
      <div className="h-1 w-full bg-[hsl(var(--e-muted))]">
        <div
          className="h-1 bg-[hsl(var(--e-gold))] transition-all duration-200"
          style={{ width: `${Math.round(((index + 1) / items.length) * 100)}%` }}
        />
      </div>

      {/* Current item */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-lg space-y-4">
          <p className="e-serif text-[1.25rem] font-[650] leading-snug">{item.title}</p>
          {item.detail ? (
            <p className="whitespace-pre-wrap text-[0.9375rem] text-[hsl(var(--e-text-secondary))]">
              {item.detail}
            </p>
          ) : null}
          {item.referenceImageKeys.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[0.75rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                Reference — how it should look
              </p>
              <div className="flex flex-wrap gap-2">
                {item.referenceImageKeys.map((key) => (
                  <ReferenceImage key={key} storageKey={key} onOpen={setEnlarged} />
                ))}
              </div>
            </div>
          ) : null}
          {acks[item.id] ? (
            <p className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-success))]">
              <CheckCircle2 className="h-4 w-4" /> Acknowledged
            </p>
          ) : null}
        </div>
      </div>

      {/* Footer */}
      <div className="space-y-2 border-t border-[hsl(var(--e-border))] px-4 py-4">
        <EButton variant="gold" className="w-full" onClick={acknowledgeCurrent}>
          <CheckCircle2 className="h-4 w-4" />
          {isLast ? "Acknowledge & continue to submit" : "Acknowledge"}
        </EButton>
        {index > 0 ? (
          <EButton
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </EButton>
        ) : null}
      </div>

      {/* Simple full-screen enlarge */}
      {enlarged ? (
        <button
          type="button"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setEnlarged(null)}
          aria-label="Close enlarged image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enlarged} alt="Reference enlarged" className="max-h-full max-w-full object-contain" />
        </button>
      ) : null}
    </div>,
    document.body
  );
}
