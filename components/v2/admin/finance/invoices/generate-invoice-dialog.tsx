"use client";

/**
 * "New invoice → From finished jobs": the existing draft generator, moved from
 * estate-invoices.tsx with its request body, defaults and wording unchanged.
 */
import { useMemo, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import type { InvoiceFormContext } from "./invoice-model";

type PeriodBasis = "SCHEDULED" | "SERVICE";

export function GenerateInvoiceDialog({
  context,
  onClose,
  onDone,
}: {
  context: InvoiceFormContext;
  onClose: () => void;
  onDone: () => void;
}) {
  const [clientId, setClientId] = useState(context.clients[0]?.id ?? "");
  const [propertyId, setPropertyId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [gstEnabled, setGstEnabled] = useState(true);
  // Defaults to the basis that cannot produce an out-of-period line. SERVICE
  // remains available for billing strictly by when work was finished.
  const [periodBasis, setPeriodBasis] = useState<PeriodBasis>("SCHEDULED");
  const [generating, setGenerating] = useState(false);

  const visibleProperties = useMemo(
    () => context.properties.filter((p) => !clientId || p.clientId === clientId),
    [context.properties, clientId],
  );

  async function generate() {
    if (!clientId) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          propertyId: propertyId || undefined,
          periodStart: periodStart ? `${periodStart}T00:00:00.000Z` : undefined,
          periodEnd: periodEnd ? `${periodEnd}T23:59:59.999Z` : undefined,
          gstEnabled,
          periodBasis,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Generate failed", description: body.error, variant: "destructive" });
        return;
      }
      const summary = body.generationSummary;
      const hasSummary =
        Number.isSafeInteger(summary?.includedJobCount) && summary.includedJobCount >= 0 &&
        Number.isSafeInteger(summary?.alreadyInvoicedJobCount) && summary.alreadyInvoicedJobCount >= 0;
      toast({
        title: "Invoice draft created",
        ...(hasSummary
          ? {
              description: `${summary.includedJobCount} job(s) included. ${summary.alreadyInvoicedJobCount} job(s) already on another non-void invoice, including drafts.`,
            }
          : {}),
      });
      onDone();
      onClose();
    } catch {
      toast({ title: "Could not reach the server", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <EModal open onClose={() => !generating && onClose()} eyebrow="Commercial" title="Generate invoice">
      <fieldset disabled={generating} className="space-y-4">
        <EField label="Client">
          <ESelect
            aria-label="Client"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setPropertyId("");
            }}
          >
            <option value="">Select client…</option>
            {context.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </ESelect>
        </EField>
        <EField label="Property" hint="Optional — defaults to all properties for this client.">
          <ESelect aria-label="Property" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">All properties</option>
            {visibleProperties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.suburb}
              </option>
            ))}
          </ESelect>
        </EField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EField label="Period from">
            <EInput type="date" aria-label="Period from" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </EField>
          <EField label="Period to">
            <EInput type="date" aria-label="Period to" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </EField>
        </div>
        <EField label="Bill jobs by" hint="Which date the period above is measured against. Only applies when a period is set.">
          <ESelect aria-label="Bill jobs by" value={periodBasis} onChange={(e) => setPeriodBasis(e.target.value as PeriodBasis)}>
            <option value="SCHEDULED">Scheduled date — matches the date printed on each line</option>
            <option value="SERVICE">Completion date - scheduled date for unfinished work</option>
          </ESelect>
        </EField>
        {periodBasis === "SERVICE" && (periodStart || periodEnd) ? (
          // The line prints its SCHEDULED date, so a job finished inside the
          // window but scheduled before it reads as out of period.
          <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">
            A job scheduled before this period but completed inside it will be included, and its line will show that earlier
            scheduled date.
          </p>
        ) : null}
        <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5">
          <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Include GST (10%)</span>
          <ESwitch checked={gstEnabled} onCheckedChange={setGstEnabled} />
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          Includes jobs that have started or finished, across all selected client properties and within the selected period.
          Jobs already on another non-void invoice (including drafts), skipped cleans and work that has not started are
          excluded. Missing billing rates must be resolved before generation. Approved shopping reimbursements are included
          automatically.
        </p>
        <EButton className="w-full" variant="gold" onClick={generate} disabled={generating || !clientId}>
          {generating ? "Generating…" : "Generate draft invoice"}
        </EButton>
      </fieldset>
    </EModal>
  );
}
