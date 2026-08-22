"use client";

/**
 * QUICK SCAN — the screen.
 *
 * The mode is chosen ONCE and stays chosen. That is the whole ergonomic idea
 * behind the tools this copies: scan, scan, scan, and every scan does the same
 * thing. Asking "what should this one do?" after each read doubles the taps,
 * and nobody does that twice.
 *
 * Because the mode is sticky it also has to be IMPOSSIBLE TO MISREAD. The
 * selected mode is large, coloured, and repeated over the camera, because the
 * failure that matters is a cleaner in Remove mode believing they are in Add
 * mode and quietly emptying a shelf. Remove and Move carry the danger colour
 * for the same reason.
 *
 * Every scan appends to a visible history with an UNDO, because the fastest way
 * to fix a mis-scan is to reverse that one action — not to abandon the session
 * and recount the cupboard.
 */

import * as React from "react";
import { Check, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { BarcodeScanner } from "@/components/v2/inventory/barcode-scanner";
import {
  QUICK_SCAN_MODES,
  QUICK_SCAN_LABELS,
  modeNeedsQuantity,
  modeWrites,
  type QuickScanMode,
} from "@/lib/inventory/quick-scan";

interface ScanReply {
  itemName: string;
  unit?: string | null;
  onHand: number;
  previousOnHand?: number;
  parLevel?: number;
  delta?: number;
  changed: boolean;
  error?: string;
  message?: string;
  code?: string;
}

interface HistoryEntry {
  id: string;
  itemName: string;
  from: number;
  to: number;
  mode: QuickScanMode;
  code: string;
  undone?: boolean;
}

/** Modes that take stock away get the danger tint. */
const DESTRUCTIVE: QuickScanMode[] = ["DECREMENT", "TRANSFER"];

export function QuickScanPanel({
  propertyId,
  properties = [],
}: {
  propertyId: string;
  /** For Move mode. Empty hides the destination picker entirely. */
  properties?: Array<{ id: string; name: string }>;
}) {
  const [mode, setMode] = React.useState<QuickScanMode>("INCREMENT");
  const [quantity, setQuantity] = React.useState("");
  const [toPropertyId, setToPropertyId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [last, setLast] = React.useState<ScanReply | null>(null);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);

  // Mirrored into refs as well as state: the scanner's callback is created once
  // and would otherwise close over the mode selected when the camera started,
  // silently applying the wrong action for the rest of the session.
  const modeRef = React.useRef(mode);
  const quantityRef = React.useRef(quantity);
  const toPropertyRef = React.useRef(toPropertyId);
  React.useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  React.useEffect(() => {
    quantityRef.current = quantity;
  }, [quantity]);
  React.useEffect(() => {
    toPropertyRef.current = toPropertyId;
  }, [toPropertyId]);

  const send = React.useCallback(
    async (code: string, override?: { mode?: QuickScanMode; quantity?: number }) => {
      const activeMode = override?.mode ?? modeRef.current;
      const typed = override?.quantity ?? Number(quantityRef.current);

      if (modeNeedsQuantity(activeMode) && !Number.isFinite(typed)) {
        toast({ title: "Enter how many first" });
        return;
      }

      setBusy(true);
      try {
        const res = await fetch("/api/inventory/quick-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            propertyId,
            mode: activeMode,
            ...(modeNeedsQuantity(activeMode) ? { quantity: typed } : {}),
            ...(activeMode === "TRANSFER" && toPropertyRef.current
              ? { toPropertyId: toPropertyRef.current }
              : {}),
          }),
        });
        const body: ScanReply = await res.json();

        if (!res.ok) {
          toast({
            title: body.message ?? "That scan did not apply",
            description: body.error === "NOT_REGISTERED" ? body.code : undefined,
            variant: "destructive",
          });
          return;
        }

        setLast(body);
        if (body.changed && typeof body.previousOnHand === "number") {
          setHistory((prev) => [
            {
              id: `${code}-${Date.now()}`,
              itemName: body.itemName,
              from: body.previousOnHand as number,
              to: body.onHand,
              mode: activeMode,
              code,
            },
            ...prev,
          ]);
        }
        // Cleared after a successful write so the next scan cannot silently
        // reuse a number that was meant for one specific item.
        if (modeNeedsQuantity(activeMode)) setQuantity("");
      } catch {
        toast({ title: "No connection", description: "That scan was not saved." });
      } finally {
        setBusy(false);
      }
    },
    [propertyId]
  );

  /** Undo puts the shelf back exactly where it was, by SETTING the old value. */
  async function undo(entry: HistoryEntry) {
    await send(entry.code, { mode: "SET", quantity: entry.from });
    setHistory((prev) => prev.map((h) => (h.id === entry.id ? { ...h, undone: true } : h)));
  }

  const activeLabel = QUICK_SCAN_LABELS[mode];
  const destructive = DESTRUCTIVE.includes(mode);

  return (
    <div className="space-y-3">
      {/* Mode picker. Big, because choosing the wrong one and not noticing is
          the expensive mistake this screen can make. */}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {QUICK_SCAN_MODES.map((m) => {
          const selected = m === mode;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={selected}
              className={
                "rounded-[var(--e-radius)] border px-2 py-2 text-[0.8125rem] font-[600] transition " +
                (selected
                  ? DESTRUCTIVE.includes(m)
                    ? "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger)/0.12)] text-[hsl(var(--e-danger))]"
                    : "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.12)] text-[hsl(var(--e-primary))]"
                  : "border-[hsl(var(--e-border))] text-[hsl(var(--e-text-secondary))]")
              }
            >
              {QUICK_SCAN_LABELS[m].label}
            </button>
          );
        })}
      </div>

      <p
        className={
          "text-center text-[0.8125rem] " +
          (destructive
            ? "font-[600] text-[hsl(var(--e-danger))]"
            : "text-[hsl(var(--e-muted-foreground))]")
        }
      >
        {activeLabel.hint}
      </p>

      {modeNeedsQuantity(mode) ? (
        <div className="flex flex-wrap gap-2">
          <EField label={mode === "SET" ? "Count on the shelf" : "How many to move"}>
            <EInput
              type="number"
              min={0}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
            />
          </EField>
          {mode === "TRANSFER" && properties.length > 0 ? (
            <EField label="Move to">
              <ESelect value={toPropertyId} onChange={(e) => setToPropertyId(e.target.value)}>
                <option value="">Choose a property…</option>
                {properties
                  .filter((p) => p.id !== propertyId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </ESelect>
            </EField>
          ) : null}
        </div>
      ) : null}

      <BarcodeScanner onScan={(code) => void send(code)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.875rem] font-[600]">
            {activeLabel.label}
            {modeWrites(mode) ? "" : " — nothing will change"}
          </span>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        </div>
      </BarcodeScanner>

      {last ? (
        <ECard>
          <ECardBody className="flex flex-wrap items-center gap-2 py-3">
            <Check className="h-4 w-4 text-[hsl(var(--e-success))]" />
            <span className="min-w-0 flex-1 truncate text-[0.875rem] font-[550]">
              {last.itemName}
            </span>
            <span className="e-tnum text-[1rem] font-[700]">
              {last.onHand}
              {last.unit ? ` ${last.unit}` : ""}
            </span>
            {typeof last.parLevel === "number" && last.onHand < last.parLevel ? (
              <EBadge tone="warning" soft>
                below par
              </EBadge>
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}

      {history.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[0.75rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
            This session
          </p>
          <ul className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            {history.slice(0, 12).map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem]">{entry.itemName}</p>
                  <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                    {QUICK_SCAN_LABELS[entry.mode].label} · {entry.from} → {entry.to}
                  </p>
                </div>
                {entry.undone ? (
                  <EBadge tone="neutral" soft>
                    undone
                  </EBadge>
                ) : (
                  <EButton variant="ghost" size="sm" disabled={busy} onClick={() => void undo(entry)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Undo
                  </EButton>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {destructive ? (
        <p className="flex items-start gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-danger))]" />
          Every scan takes stock away while this mode is selected.
        </p>
      ) : null}
    </div>
  );
}
