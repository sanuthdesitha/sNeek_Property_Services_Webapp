"use client";

/**
 * Extras & scope changes — add/remove quote-style extras on a converted job at
 * any time. Talks to /api/admin/jobs/[id]/quote-extras: the server appends the
 * extra to the cleaner-form Additionals, bumps the fixed price, updates the
 * invoice note and audits the change. It emails the client the new total ONLY
 * when asked (`notifyClient: true`): "Email the client the new total" in the
 * Add an extra window, unticked by default (owner default 2026-11, board
 * "Everyday dialogs and sheets"). The new price is the server's answer; this
 * component never adds prices up itself.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackagePlus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EFacts, EFactRow, ENote } from "@/components/v2/ui/form-dialog-parts";
import {
  EConfirmModal,
  EField,
  EInput,
  ESelect,
} from "@/components/v2/admin/estate-kit";
import { EXTRAS_BY_CATEGORY, EXTRAS_BY_ID } from "@/lib/pricing/extras-catalog";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";

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

/** What happened to the client email, in words: asked or not, sent or why not. */
function emailOutcome(asked: boolean, body: { emailed?: unknown; recipients?: unknown }): string {
  if (!asked) return "saved without sending a client email";
  if (body.emailed === true) return "client emailed";
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  return recipients.length === 0 ? "client not emailed: no client email on file" : "client email not sent: the email service did not accept it";
}

export function JobExtrasPanel({
  jobId,
  fixedPrice,
  context,
}: {
  jobId: string;
  fixedPrice: number | null;
  /** Context line for the Add an extra window ("J-1072 · Coogee Terrace"). */
  context?: string;
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
  // PIN tier: removing an extra rewrites the client's fixed price and emails
  // them the new total, so a mis-click is a billing correction, not an undo.
  const [removeTarget, setRemoveTarget] = useState<ExtraRow | null>(null);

  // Add form
  const [pick, setPick] = useState<string>("");
  const [label, setLabel] = useState("");
  const [price, setPrice] = useState("");
  const [instructions, setInstructions] = useState("");
  const [note, setNote] = useState("");
  const [emailClient, setEmailClient] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
    if (busy) return;
    const trimmedLabel = label.trim();
    const priceNum = Number(price);
    if (!trimmedLabel) {
      setAddError("Say what the extra is.");
      toast({ title: "Give the extra a name", variant: "destructive" });
      return;
    }
    if (price.trim() === "" || !Number.isFinite(priceNum) || priceNum < 0) {
      setAddError("Enter the price ex GST.");
      toast({ title: "Enter a valid price", variant: "destructive" });
      return;
    }
    setAddError(null);
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
          // Only an explicit tick asks the server to email the client.
          ...(emailClient ? { notifyClient: true } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(body.error ?? "The extra was not added.");
        toast({ title: "Couldn't add the extra", description: body.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Extra added",
        description: `New total ${money(body.fixedPrice)} · ${emailOutcome(emailClient, body)}`,
      });
      setPick("");
      setLabel("");
      setPrice("");
      setInstructions("");
      setNote("");
      setEmailClient(false);
      setAddOpen(false);
      await load();
      router.refresh();
    } catch {
      setAddError("Could not reach the server. It may or may not have been added; check the list before trying again.");
    } finally {
      setBusy(false);
    }
  }

  async function removeExtra(credentials?: { pin?: string; password?: string }) {
    const row = removeTarget;
    if (!row) return;
    setBusy(true);
    try {
      // The PIN travels with the removal and is verified by the route itself.
      const res = await fetch(`/api/admin/jobs/${jobId}/quote-extras`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeLabels: [row.label], security: credentials ?? {} }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't remove the extra", description: sensitiveVerificationText(body.error), variant: "destructive" });
        return;
      }
      toast({
        title: "Extra removed",
        description: `New total ${money(body.fixedPrice)} · ${
          body.emailed ? "client emailed" : "saved without sending a client email"
        }`,
      });
      setRemoveTarget(null);
      await load();
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Couldn't remove the extra",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
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
                  onClick={() => setRemoveTarget(row)}
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-3">
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Saved without a client email unless you tick it when adding.</p>
        <EButton variant="outline" size="sm" onClick={() => setAddOpen(true)} disabled={busy || loading}>
          <PackagePlus className="h-3.5 w-3.5" /> Add an extra
        </EButton>
      </div>

      <EActionDialog
        open={addOpen}
        layout="form"
        eyebrow={[context, state.fixedPrice != null ? `Fixed price ${money(state.fixedPrice)}` : state.effectivePrice != null ? `Client total ${money(state.effectivePrice)}` : null].filter(Boolean).join(" · ")}
        title="Add an extra"
        phoneTitle="Add an extra"
        busy={busy}
        onClose={() => setAddOpen(false)}
        footer={(
          <>
            <EButton variant="outline" size="sm" className="max-sm:hidden" onClick={() => setAddOpen(false)} disabled={busy}>Cancel</EButton>
            <EButton size="sm" onClick={() => void addExtra()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {busy ? "Adding…" : "Add extra"}
            </EButton>
          </>
        )}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <EField label="From the catalogue, optional">
            <ESelect value={pick} onChange={(e) => onPick(e.target.value)} className="max-sm:h-11 max-sm:text-[1rem]">
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
          <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
            <EField label="What">
              <EInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Balcony glass, outside" className="max-sm:h-11 max-sm:text-[1rem]" />
            </EField>
            <EField label="Price ex GST">
              <EInput type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="e-tnum max-sm:h-11 max-sm:text-[1rem]" />
            </EField>
          </div>
          <EField label="Instructions for the cleaner, optional">
            <EInput value={instructions} onChange={(e) => setInstructions(e.target.value)} className="max-sm:h-11 max-sm:text-[1rem]" />
          </EField>
          <EField label="Internal note, optional">
            <EInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it was added" className="max-sm:h-11 max-sm:text-[1rem]" />
          </EField>
          <EFacts label="What changes">
            <EFactRow label="Fixed price now" value={state.effectivePrice != null ? money(state.effectivePrice) : "Rate card"} />
            <EFactRow label="Cleaner checklist" value="+1 item" />
            <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">The server adds the price to the fixed price; the new total shows once it is saved.</p>
          </EFacts>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.8125rem]">
            <input type="checkbox" checked={emailClient} onChange={(e) => setEmailClient(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--e-primary))]" />
            <span>Email the client the new total</span>
          </label>
        </fieldset>
        {addError ? <ENote tone="problem" role="alert">Not added: {addError}</ENote> : null}
      </EActionDialog>

      <EConfirmModal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title="Remove this extra"
        description={
          removeTarget
            ? `Removing "${removeTarget.label}" drops it off the cleaner's checklist, lowers the client's fixed price. No client email is sent.`
            : undefined
        }
        confirmLabel="Remove extra"
        requireSecurity
        loading={busy}
        onConfirm={removeExtra}
      />
    </div>
  );
}
