"use client";

/**
 * Extras & scope changes — add/remove quote-style extras on a converted job at
 * any time. Talks to /api/admin/jobs/[id]/quote-extras: the server appends the
 * extra to the cleaner-form Additionals, bumps the fixed price, updates the
 * invoice note, audits the change and EMAILS THE CLIENT the new total.
 * Native Estate (primitives + estate-kit + lucide only).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, PackagePlus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { EXTRAS_BY_CATEGORY, EXTRAS_BY_ID } from "@/lib/pricing/extras-catalog";

interface ExtraRow {
  id: string;
  label: string;
  instructions: string | null;
  /** Ex-GST price for post-conversion extras; null = included in quoted total. */
  price: number | null;
}

interface ExtrasState {
  extras: ExtraRow[];
  fixedPrice: number | null;
  quoteTotal: number | null;
  effectivePrice: number | null;
}

const CUSTOM = "__custom__";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export function JobExtrasPanel({
  jobId,
  fixedPrice,
}: {
  jobId: string;
  fixedPrice: number | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<ExtrasState>({
    extras: [],
    fixedPrice,
    quoteTotal: null,
    effectivePrice: fixedPrice,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Add form
  const [pick, setPick] = useState<string>("");
  const [label, setLabel] = useState("");
  const [price, setPrice] = useState("");
  const [instructions, setInstructions] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/quote-extras`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setState({
          extras: Array.isArray(body.extras) ? body.extras : [],
          fixedPrice: body.fixedPrice ?? null,
          quoteTotal: body.quoteTotal ?? null,
          effectivePrice: body.effectivePrice ?? null,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  function onPick(value: string) {
    setPick(value);
    if (value && value !== CUSTOM) {
      const option = EXTRAS_BY_ID[value];
      if (option) {
        setLabel(option.label);
        setPrice(String(option.price));
        setInstructions(option.instructions);
        return;
      }
    }
    setLabel("");
    setPrice("");
    setInstructions("");
  }

  const addedTotal = useMemo(
    () => state.extras.reduce((sum, e) => sum + (e.price ?? 0), 0),
    [state.extras]
  );

  async function addExtra() {
    const trimmedLabel = label.trim();
    const priceNum = Number(price);
    if (!trimmedLabel) {
      toast({ title: "Give the extra a name", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast({ title: "Enter a valid price", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/quote-extras`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          add: [
            {
              id: pick && pick !== CUSTOM ? pick : undefined,
              label: trimmedLabel,
              price: priceNum,
              instructions: instructions.trim() || undefined,
            },
          ],
          note: note.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't add the extra", description: body.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Extra added",
        description: `New total ${money(body.fixedPrice)} · ${
          body.emailed ? "client emailed" : "client email not sent (no recipient / provider off)"
        }`,
      });
      setPick("");
      setLabel("");
      setPrice("");
      setInstructions("");
      setNote("");
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeExtra(row: ExtraRow) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/quote-extras`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeLabels: [row.label] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't remove the extra", description: body.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Extra removed",
        description: `New total ${money(body.fixedPrice)} · ${
          body.emailed ? "client emailed" : "client email not sent"
        }`,
      });
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Current extras */}
      {loading ? (
        <p className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading extras…
        </p>
      ) : state.extras.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          No extras on this job yet. Anything you add flows straight onto the cleaner&apos;s checklist.
        </p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--e-border))]">
          {state.extras.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-2 text-[0.8125rem]">
              <span className="min-w-0">
                <span className="font-[550]">{row.label}</span>
                {row.instructions ? (
                  <span className="block text-[0.75rem] text-[hsl(var(--e-text-faint))]">{row.instructions}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {row.price != null ? (
                  <span className="e-numeral tabular-nums">{money(row.price)}</span>
                ) : (
                  <EBadge tone="neutral" soft>In quoted total</EBadge>
                )}
                <EButton
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${row.label}`}
                  disabled={busy}
                  onClick={() => void removeExtra(row)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-[hsl(var(--e-danger))]" />
                </EButton>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Running price impact */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2 text-[0.8125rem]">
        <span>
          <span className="text-[hsl(var(--e-text-faint))]">Client total: </span>
          <span className="e-numeral">
            {state.effectivePrice != null ? money(state.effectivePrice) : "Rate card"}
          </span>
        </span>
        {addedTotal > 0 ? (
          <span className="text-[hsl(var(--e-muted-foreground))]">
            includes {money(addedTotal)} of added extras (ex GST)
          </span>
        ) : null}
        {state.quoteTotal != null && state.fixedPrice == null ? (
          <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">from accepted quote</span>
        ) : null}
      </div>

      {/* Add form */}
      <div className="space-y-3 border-t border-[hsl(var(--e-border))] pt-3">
        <EField label="Add an extra">
          <ESelect value={pick} onChange={(e) => onPick(e.target.value)} disabled={busy}>
            <option value="">Pick from the catalogue…</option>
            {EXTRAS_BY_CATEGORY.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} — {money(option.price)}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={CUSTOM}>Custom extra…</option>
          </ESelect>
        </EField>
        {pick ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <EField label="Label">
                <EInput value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
              </EField>
              <EField label="Price (ex GST)">
                <EInput
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  disabled={busy}
                />
              </EField>
            </div>
            <EField label="Instructions for the cleaner (optional)">
              <ETextarea
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={busy}
              />
            </EField>
            <EField label="Note to the client (optional, included in the email)">
              <EInput value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
            </EField>
            <div className="flex justify-end">
              <EButton variant="gold" size="sm" onClick={() => void addExtra()} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackagePlus className="h-3.5 w-3.5" />}
                Add extra &amp; update price
              </EButton>
            </div>
          </>
        ) : null}
        <p className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          <Mail className="h-3.5 w-3.5" /> The client is emailed automatically about every change here,
          including the updated total.
        </p>
      </div>
    </div>
  );
}
