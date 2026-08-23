"use client";

/**
 * Invoice numbering — the prefix, counter and padding behind every invoice
 * number this system issues, on both rails.
 *
 * It sits in the Bank & payment tab because an invoice number is part of the
 * invoice setup: the same screen already decides the bank details and the
 * payment reference note that tells clients to quote that number back.
 *
 * Reads and writes GET/PUT /api/admin/settings/invoice-numbering. Loaded from
 * the client rather than passed down from the page, like the other settings
 * sections with their own endpoint (gateways, Xero, integrations) — that keeps
 * the ADMIN-only rule in the route alone instead of restating it in the page.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import {
  DEFAULT_SEQUENCES,
  previewNextInvoiceNumber,
  type InvoiceSequenceKey,
  type InvoiceSequenceShape,
} from "@/lib/billing/invoice-numbering";
import {
  EField,
  EInput,
  EModal,
  ESaveStatus,
  ESectionHeading,
  useSaveStatus,
} from "./estate-form";

type Sequences = Record<InvoiceSequenceKey, InvoiceSequenceShape>;

const RAILS: Array<{ key: InvoiceSequenceKey; title: string; description: string }> = [
  {
    key: "CLIENT",
    title: "Client invoices",
    description: "Money out — the invoices sent to clients for work completed.",
  },
  {
    key: "CLEANER",
    title: "Cleaner & payee invoices",
    description: "Money in — invoices cleaners and QA inspectors raise against us.",
  },
];

export function InvoiceNumberingSection() {
  const [sequences, setSequences] = useState<Sequences | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/invoice-numbering", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(body.error ?? "Could not load invoice numbering.");
          return;
        }
        setSequences(body.sequences as Sequences);
      } catch (err) {
        // Surfaced, not swallowed: a settings screen that silently shows the
        // defaults would invite an admin to "fix" a counter that is actually
        // fine, and saving that guess would renumber live invoices.
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load invoice numbering.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Invoicing"
        title="Invoice numbering"
        description="Each rail counts separately. Numbers are issued in order and never re-used, so a gap means an invoice was started and abandoned — not that one went missing."
      />

      {loadError ? (
        <ECard className="p-6">
          <div className="flex gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[hsl(var(--e-danger))]" />
            <div>
              <p className="text-[0.875rem] font-[550]">Could not load invoice numbering</p>
              <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{loadError}</p>
            </div>
          </div>
        </ECard>
      ) : !sequences ? (
        <ECard className="p-6">
          <p className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading invoice numbering…
          </p>
        </ECard>
      ) : (
        RAILS.map((rail) => (
          <SequenceCard
            key={rail.key}
            sequenceKey={rail.key}
            title={rail.title}
            description={rail.description}
            initial={sequences[rail.key] ?? DEFAULT_SEQUENCES[rail.key]}
          />
        ))
      )}
    </div>
  );
}

function SequenceCard({
  sequenceKey,
  title,
  description,
  initial,
}: {
  sequenceKey: InvoiceSequenceKey;
  title: string;
  description: string;
  initial: InvoiceSequenceShape;
}) {
  const [prefix, setPrefix] = useState(initial.prefix);
  // What the server currently holds. Only moves on a successful save, so the
  // "you are going backwards" test always compares against the number that has
  // really been issued, not against whatever was typed a moment ago.
  const [saved, setSaved] = useState<InvoiceSequenceShape>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { status, flash } = useSaveStatus();

  // Kept as strings so a half-typed field ("" while the admin clears it, or
  // "1.5" mid-keystroke) reaches the validator as typed, instead of being
  // coerced to a number the admin never chose.
  const [lastNumberText, setLastNumberText] = useState(String(initial.lastNumber));
  const [paddingText, setPaddingText] = useState(String(initial.padding));

  // A cleared box is unfinished, not zero. Without this Number("") would be 0
  // and the card would both preview "next invoice 1" and raise the re-issue
  // alarm at somebody who has simply not finished typing yet.
  const hasLastNumber = lastNumberText.trim() !== "";
  const parsedLastNumber = Number(lastNumberText);
  const validLastNumber = hasLastNumber && Number.isInteger(parsedLastNumber) && parsedLastNumber >= 0;
  const isLowering = validLastNumber && parsedLastNumber < saved.lastNumber;

  // The preview comes from the SAME pure function that names the real invoice,
  // so what the admin reads here is what the next document will actually carry.
  const preview = useMemo(
    () =>
      validLastNumber
        ? previewNextInvoiceNumber({
            prefix,
            lastNumber: parsedLastNumber,
            padding: Number(paddingText) || 1,
          })
        : null,
    [prefix, parsedLastNumber, validLastNumber, paddingText]
  );

  async function save(confirmLowerNumber: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/invoice-numbering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: sequenceKey,
          prefix,
          lastNumber: lastNumberText,
          padding: paddingText,
          confirmLowerNumber,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && body.requiresConfirmation) {
        // Not an error the admin should have to re-type their way out of — the
        // server is asking them to say yes to re-issuing numbers.
        setConfirmOpen(true);
        return;
      }
      if (!res.ok) {
        // The route returns the validator's own wording; showing anything else
        // would state a different rule than the one that rejected them.
        flash("error", body.error ?? "Could not save invoice numbering.");
        return;
      }

      const next = body.sequence as InvoiceSequenceShape;
      setSaved(next);
      setPrefix(next.prefix);
      setLastNumberText(String(next.lastNumber));
      setPaddingText(String(next.padding));
      setConfirmOpen(false);
      flash("saved", `Saved — next invoice will be ${body.preview}`);
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Could not save invoice numbering.");
    } finally {
      setSaving(false);
    }
  }

  const fieldId = `seq-${sequenceKey.toLowerCase()}`;

  return (
    <ECard className="p-6">
      <div className="mb-5">
        <h3 className="text-[0.9375rem] font-[550]">{title}</h3>
        <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <EField label="Prefix" htmlFor={`${fieldId}-prefix`} hint="Up to 12 characters.">
          <EInput id={`${fieldId}-prefix`} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </EField>
        <EField
          label="Last issued number"
          htmlFor={`${fieldId}-last`}
          hint="The next invoice is this plus one."
        >
          <EInput
            id={`${fieldId}-last`}
            type="number"
            min={0}
            value={lastNumberText}
            onChange={(e) => setLastNumberText(e.target.value)}
          />
        </EField>
        <EField label="Padding" htmlFor={`${fieldId}-padding`} hint="Digits to pad to, 1–10.">
          <EInput
            id={`${fieldId}-padding`}
            type="number"
            min={1}
            max={10}
            value={paddingText}
            onChange={(e) => setPaddingText(e.target.value)}
          />
        </EField>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-4 py-3">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-secondary))]">
          Next invoice
        </span>
        {preview ? (
          <span className="e-numeral text-[1rem] font-[550] text-[hsl(var(--e-foreground))]">{preview}</span>
        ) : (
          <span className="text-[0.875rem] text-[hsl(var(--e-text-faint))]">
            Enter a whole last-issued number to preview.
          </span>
        )}
      </div>

      {/* Warned BEFORE the request goes out, not only after the server refuses:
          the admin should see what lowering the counter costs while the old
          number is still in front of them. */}
      {isLowering ? (
        <div className="mt-4 flex gap-2.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.35)] bg-[hsl(var(--e-danger)/0.06)] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[hsl(var(--e-danger))]" />
          <p className="text-[0.8125rem] leading-relaxed text-[hsl(var(--e-foreground))]">
            This sequence has already issued up to{" "}
            <span className="e-numeral font-[550]">{saved.lastNumber}</span>. Saving{" "}
            <span className="e-numeral font-[550]">{parsedLastNumber}</span> will re-issue numbers that
            are already printed on invoices people hold — two different documents would carry the same
            reference. You will be asked to confirm.
          </p>
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        <EButton onClick={() => save(false)} disabled={saving}>
          {saving ? "Saving…" : "Save numbering"}
        </EButton>
      </div>

      <EModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        eyebrow={title}
        title="Re-issue numbers that are already in use?"
      >
        <div className="space-y-4">
          <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-foreground))]">
            This sequence has issued up to{" "}
            <span className="e-numeral font-[550]">{saved.lastNumber}</span>. Setting it back to{" "}
            <span className="e-numeral font-[550]">{parsedLastNumber}</span> means the next invoice will
            be called <span className="e-numeral font-[550]">{preview}</span> — a number that is already
            on a sent document.
          </p>
          <p className="text-[0.8125rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
            Only do this to correct a starting number that was entered wrongly and has not been invoiced
            against yet. Raising the counter again afterwards does not undo it: the duplicated invoices
            stay duplicated.
          </p>
          <div className="flex items-center justify-end gap-3 pt-1">
            <EButton variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>
              Cancel
            </EButton>
            <EButton variant="danger" onClick={() => save(true)} disabled={saving}>
              {saving ? "Saving…" : "Re-issue anyway"}
            </EButton>
          </div>
        </div>
      </EModal>
    </ECard>
  );
}
