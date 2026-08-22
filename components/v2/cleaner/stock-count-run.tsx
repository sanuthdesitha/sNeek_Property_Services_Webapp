"use client";

/**
 * A SCANNED STOCK COUNT, END TO END.
 *
 * Sibling to `stock-run-workspace.tsx`, which is the same job done by typing
 * every number into a form. Both are wanted: typing is faster for a three-item
 * top-up, scanning is far faster for a full cupboard. They are separate
 * components because the interactions have almost nothing in common — one is a
 * form, this is a camera — and folding a camera-first flow into a 510-line
 * typed form would have made both worse.
 *
 * Three phases, and the middle one is the point of the whole thing:
 *
 *   SCAN     camera open, tally climbing. Nothing is written.
 *   REVIEW   what the scanner made of the cupboard, every number editable.
 *   APPLY    the stock is replaced, and only now.
 *
 * The review phase exists because a scan run is not evidence, it is a first
 * draft. A bottle behind the door goes unscanned; a carton gets read twice
 * because someone walked back past it. Writing straight from the camera would
 * make the cleaner's job "get the scanning perfect", which nobody can, instead
 * of "check the numbers", which anyone can.
 *
 * The scan list is kept as RAW CODES rather than resolved items. Resolution and
 * counting happen server-side, so what the review screen shows and what the
 * apply endpoint writes come from the same functions over the same input — the
 * client cannot display one number and save another.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, PackageSearch, ScanLine, Undo2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EConfirmModal, EInput } from "@/components/v2/admin/estate-kit";
import { BarcodeScanner } from "@/components/v2/inventory/barcode-scanner";

interface CountLine {
  itemId: string;
  itemName: string;
  previousOnHand: number;
  countedOnHand: number;
  parLevel: number;
  variance: number;
  needed: number;
  unit?: string | null;
}

interface Reconciliation {
  counted: CountLine[];
  wouldZero: CountLine[];
  unknown: Array<{ code: string; scans: number }>;
  rejected: Array<{ raw: string; reason: string }>;
  requiresZeroConfirmation: boolean;
  shoppingNeeds: Array<{ itemId: string; itemName: string; needed: number; unit?: string | null }>;
}

type Phase = "scan" | "review" | "done";

export function StockCountRun({
  propertyId,
  propertyName,
}: {
  propertyId: string;
  propertyName: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>("scan");
  const [scans, setScans] = React.useState<string[]>([]);
  const [overrides, setOverrides] = React.useState<Record<string, number>>({});
  const [review, setReview] = React.useState<Reconciliation | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [zeroPrompt, setZeroPrompt] = React.useState<CountLine[] | null>(null);
  const [result, setResult] = React.useState<Reconciliation | null>(null);

  const addScan = React.useCallback((code: string) => {
    // Appended, never de-duplicated here: ten identical bottles are ten scans,
    // and the server is what folds them into a count.
    setScans((prev) => [...prev, code]);
  }, []);

  async function loadReview(nextOverrides = overrides) {
    setBusy(true);
    try {
      const res = await fetch("/api/inventory/scan/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId, scans, overrides: nextOverrides }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not read that count.");
      setReview(body);
      setPhase("review");
    } catch (err: any) {
      toast({ title: "Could not build the summary", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  async function apply(confirmZero = false) {
    setBusy(true);
    try {
      const res = await fetch("/api/inventory/scan/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId, scans, overrides, confirmZero }),
      });
      const body = await res.json();

      if (res.status === 409 && body.error === "ZERO_CONFIRMATION_REQUIRED") {
        // The question, not a failure. Show exactly what would be wiped.
        setZeroPrompt(body.wouldZero ?? []);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Could not save the count.");

      setZeroPrompt(null);
      setResult(body);
      setPhase("done");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Count not saved", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  function setOverride(itemId: string, raw: string) {
    const value = Number(raw);
    setOverrides((prev) => {
      const next = { ...prev };
      if (raw.trim() === "") {
        // Cleared means "go back to what the scanner said", not "zero".
        delete next[itemId];
      } else if (Number.isFinite(value) && value >= 0) {
        next[itemId] = value;
      }
      return next;
    });
  }

  /* ── SCAN ──────────────────────────────────────────────────────────────── */
  if (phase === "scan") {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-[1.125rem] font-[600]">Stock count</h1>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{propertyName}</p>
        </div>

        <BarcodeScanner onScan={addScan}>
          <div className="flex items-center justify-between">
            <span className="text-[0.875rem] font-[600]">{scans.length} scanned</span>
            {scans.length > 0 ? (
              <button
                type="button"
                onClick={() => setScans((prev) => prev.slice(0, -1))}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[0.75rem]"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo last
              </button>
            ) : null}
          </div>
        </BarcodeScanner>

        <EButton
          variant="gold"
          className="w-full"
          disabled={scans.length === 0 || busy}
          onClick={() => loadReview()}
        >
          {busy ? "Working…" : `Finish and review ${scans.length} scans`}
        </EButton>

        {scans.length === 0 ? (
          <p className="text-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Scan every item in the cupboard. Repeats are counted, so scan each bottle.
          </p>
        ) : null}
      </div>
    );
  }

  /* ── REVIEW ────────────────────────────────────────────────────────────── */
  if (phase === "review" && review) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-[1.125rem] font-[600]">Check the count</h1>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {propertyName} · {scans.length} scans
            </p>
          </div>
          <EButton variant="outline" size="sm" onClick={() => setPhase("scan")}>
            <ScanLine className="h-3.5 w-3.5" /> Scan more
          </EButton>
        </div>

        {review.rejected.length > 0 ? (
          <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning)/0.1)] px-3 py-2 text-[0.8125rem]">
            {review.rejected.length} scan{review.rejected.length === 1 ? "" : "s"} could not be read.
            Scan those items again, or type the number in below.
          </p>
        ) : null}

        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="text-[0.95rem]">Counted</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            {review.counted.length === 0 ? (
              <EEmptyState title="Nothing counted yet" description="Go back and scan the shelf." />
            ) : (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {review.counted.map((line) => (
                  <li key={line.itemId} className="flex flex-wrap items-center gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-[550]">{line.itemName}</p>
                      <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        was {line.previousOnHand}
                        {line.variance !== 0
                          ? ` · ${line.variance > 0 ? "+" : ""}${line.variance}`
                          : " · no change"}
                      </p>
                    </div>
                    <EInput
                      type="number"
                      min={0}
                      className="w-20"
                      value={String(overrides[line.itemId] ?? line.countedOnHand)}
                      onChange={(e) => setOverride(line.itemId, e.target.value)}
                      aria-label={`Counted ${line.itemName}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </ECardBody>
        </ECard>

        {review.wouldZero.length > 0 ? (
          <ECard>
            <ECardHeader className="pb-2">
              <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
                <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-warning))]" />
                Not scanned — will be set to zero
              </ECardTitle>
            </ECardHeader>
            <ECardBody className="pt-0">
              <p className="mb-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                These are on file here but were not scanned. If any are actually in the cupboard,
                type the number.
              </p>
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {review.wouldZero.map((line) => (
                  <li key={line.itemId} className="flex flex-wrap items-center gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-[550]">{line.itemName}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        was {line.previousOnHand}
                      </p>
                    </div>
                    <EInput
                      type="number"
                      min={0}
                      className="w-20"
                      placeholder="0"
                      value={overrides[line.itemId] != null ? String(overrides[line.itemId]) : ""}
                      onChange={(e) => setOverride(line.itemId, e.target.value)}
                      aria-label={`Counted ${line.itemName}`}
                    />
                  </li>
                ))}
              </ul>
            </ECardBody>
          </ECard>
        ) : null}

        {review.unknown.length > 0 ? (
          <ECard>
            <ECardHeader className="pb-2">
              <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
                <PackageSearch className="h-4 w-4" /> Not recognised
              </ECardTitle>
            </ECardHeader>
            <ECardBody className="pt-0">
              <p className="mb-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                These barcodes are not registered yet. The office can add them — your count is
                unaffected.
              </p>
              <ul className="space-y-1 text-[0.8125rem]">
                {review.unknown.map((row) => (
                  <li key={row.code} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[0.75rem]">{row.code}</span>
                    <EBadge tone="neutral" soft>
                      ×{row.scans}
                    </EBadge>
                  </li>
                ))}
              </ul>
            </ECardBody>
          </ECard>
        ) : null}

        <div className="flex gap-2">
          <EButton variant="outline" className="flex-1" disabled={busy} onClick={() => loadReview()}>
            Recalculate
          </EButton>
          <EButton variant="gold" className="flex-1" disabled={busy} onClick={() => apply(false)}>
            {busy ? "Saving…" : "Approve count"}
          </EButton>
        </div>

        <EConfirmModal
          open={Boolean(zeroPrompt)}
          onClose={() => setZeroPrompt(null)}
          title="Set these to zero?"
          description={
            zeroPrompt
              ? `${zeroPrompt.length} item${
                  zeroPrompt.length === 1 ? "" : "s"
                } on file here were not scanned: ${zeroPrompt
                  .slice(0, 8)
                  .map((l) => l.itemName)
                  .join(", ")}${
                  zeroPrompt.length > 8 ? "…" : ""
                }. Approving records them as empty. Are you sure none were missed?`
              : ""
          }
          confirmLabel="Yes, none were missed"
          loading={busy}
          onConfirm={() => apply(true)}
        />
      </div>
    );
  }

  /* ── DONE ──────────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Check className="h-5 w-5 text-[hsl(var(--e-success))]" />
        <h1 className="text-[1.125rem] font-[600]">Count saved</h1>
      </div>

      {result && result.shoppingNeeds.length > 0 ? (
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="text-[0.95rem]">Needs restocking</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {result.shoppingNeeds.map((need) => (
                <li key={need.itemId} className="flex items-center justify-between gap-2 py-2">
                  <span className="truncate text-[0.875rem]">{need.itemName}</span>
                  <span className="text-[0.875rem] font-[600]">
                    {need.needed}
                    {need.unit ? ` ${need.unit}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </ECardBody>
        </ECard>
      ) : (
        <EEmptyState
          title="Everything is stocked"
          description="Nothing at this property is below its par level."
        />
      )}

      <EButton variant="outline" className="w-full" onClick={() => router.push("/v2/cleaner")}>
        Back to my schedule
      </EButton>
    </div>
  );
}
