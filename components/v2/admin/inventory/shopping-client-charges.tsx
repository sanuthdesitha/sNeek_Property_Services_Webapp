"use client";

/**
 * Charges to clients for one shopping run: one card per property allocation
 * (board "Shopping run", 2026-11-17). A charge waiting for review is an
 * attention band with its fields; an approved one is a good band and stays
 * editable until it is on an invoice; an invoiced one is locked. Same endpoint
 * and rules as before: the save carries the revision it was read at, so a
 * charge someone else changed meanwhile is refused and the entries stay.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneCard, toneMutedClass, type ETone } from "@/components/v2/ui/tone-band";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";

type Treatment = "PENDING" | "AGENCY_DISBURSEMENT" | "RECHARGE";

type Charge = {
  id: string;
  revision: number;
  expenseAmount: number;
  expenseBillable: boolean;
  shoppingMinutes: number;
  allocatedMinutes: number;
  hourlyRate: number | null;
  labourAmount: number;
  treatment: Treatment;
  status: "DRAFT" | "APPROVED";
  invoiceId: string | null;
  reviewNote: string | null;
  property: { name: string };
  client: { name: string };
};

const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
const MUTED = "text-[hsl(var(--e-muted-foreground))]";

export function ShoppingClientCharges({ runId }: { runId: string }) {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/inventory/shopping-runs/${runId}/client-charges`, { cache: "no-store" });
      const body = await response.json();
      if (request !== generation.current) return;
      if (!response.ok || !Array.isArray(body.charges)) throw new Error(body.error || "Client charges unavailable.");
      setCharges(body.charges);
      setError("");
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Client charges unavailable.");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    setCharges([]);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);

  return (
    <section aria-labelledby="client-charges-heading" className="min-w-0 space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[hsl(var(--e-foreground))]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="client-charges-heading" className="text-[0.9375rem] font-[600]">Charges to clients</h2>
        <EButton size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>Refresh charges</EButton>
      </div>
      <p className={cn("text-[0.8125rem]", MUTED)}>Review each property&apos;s share before its next invoice. The client hourly rate is separate from the cleaner&apos;s pay. General stock is charged when it is delivered to a property.</p>
      {error ? (
        <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p>
      ) : loading && !charges.length ? (
        <p role="status" className={cn("text-[0.8125rem]", MUTED)}>Loading client charges…</p>
      ) : !charges.length ? (
        <p className="text-[0.8125rem]">No client charges yet. Complete a property shopping run or deliver general stock to a property.</p>
      ) : null}
      {charges.map((charge) => (
        <ChargeEditor key={`${charge.id}:${charge.revision}`} charge={charge} runId={runId} refresh={refresh} />
      ))}
    </section>
  );
}

function chargeTone(charge: Charge): ETone | null {
  if (charge.invoiceId) return null;
  return charge.status === "APPROVED" ? "good" : "attention";
}

function chargeSummary(charge: Charge): string {
  const time = charge.shoppingMinutes > 0
    ? ` · ${charge.shoppingMinutes} min${charge.hourlyRate != null ? ` at ${money(charge.hourlyRate)}/h, saved time charge ${money(charge.labourAmount)}` : ", no client rate yet"}`
    : "";
  return `${charge.client.name} · purchases ${money(charge.expenseAmount)}${time}`;
}

function ChargeEditor({ charge, runId, refresh }: { charge: Charge; runId: string; refresh: () => Promise<void> }) {
  const [minutes, setMinutes] = useState(String(charge.shoppingMinutes));
  const [rate, setRate] = useState(charge.hourlyRate == null ? "" : String(charge.hourlyRate));
  const [treatment, setTreatment] = useState<Treatment>(charge.treatment);
  const [note, setNote] = useState(charge.reviewNote ?? "");
  const [expenseBillable, setExpenseBillable] = useState(charge.expenseBillable ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const tone = chargeTone(charge);
  // Unsaved preview, as before: labelled as an estimate, never stored from here.
  const preview =
    minutes.trim() && rate.trim() && Number.isFinite(Number(minutes)) && Number.isFinite(Number(rate)) && Number(minutes) >= 0 && Number(rate) >= 0
      ? Number(((Number(minutes) / 60) * Number(rate)).toFixed(2))
      : null;
  const noteRequired = treatment === "AGENCY_DISBURSEMENT" || !expenseBillable;

  async function save(status: "DRAFT" | "APPROVED") {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (!minutes.trim()) throw new Error("Enter the minutes to charge, including zero if waived.");
      const response = await fetch(`/api/admin/inventory/shopping-runs/${runId}/client-charges`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: charge.id, expectedRevision: charge.revision, shoppingMinutes: Number(minutes), hourlyRate: rate.trim() ? Number(rate) : null, treatment, status, expenseBillable, reviewNote: note }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Approval not confirmed. Refresh charges before retrying.");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Approval not confirmed.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const header = (
    <div>
      <b className="break-words">{charge.property.name}</b>
      <p className={cn("text-[0.75rem]", tone ? toneMutedClass(tone) : MUTED)}>{chargeSummary(charge)}</p>
    </div>
  );

  if (charge.invoiceId) {
    return (
      <EToneCard tone={null} header={header} pill={<span className="rounded-full bg-[hsl(var(--e-surface-raised))] px-2 py-0.5 text-[0.75rem]">Invoiced, locked</span>}>
        <p className={cn("text-[0.8125rem]", MUTED)}>On an invoice. A change now needs a credit note on that invoice.</p>
      </EToneCard>
    );
  }

  return (
    <EToneCard tone={tone} header={header} pill={charge.status === "APPROVED" ? "Approved for next invoice" : "Review needed"} bodyClassName="space-y-3">
      {charge.status === "APPROVED" ? <p className={cn("text-[0.8125rem]", MUTED)}>Still editable until it is on an invoice.</p> : null}
      <fieldset disabled={busy} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-h-11 items-center gap-2 text-[0.8125rem]">
            <input className="h-5 w-5 shrink-0 accent-[hsl(var(--e-accent-portal))]" type="checkbox" checked={expenseBillable} onChange={(event) => setExpenseBillable(event.target.checked)} />
            Bill purchase cost to client
          </label>
          <label className="w-[9.5rem] text-[0.8125rem]">
            Minutes to charge (up to {charge.allocatedMinutes})
            <EInput aria-label={`Minutes for ${charge.property.name}`} type="number" min="0" max={charge.allocatedMinutes} step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
          </label>
          <label className="w-[9.5rem] text-[0.8125rem]">
            Client hourly rate (AUD)
            <EInput aria-label={`Client rate for ${charge.property.name}`} type="number" min="0" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} />
          </label>
          <label className="min-w-[12rem] flex-1 text-[0.8125rem]">
            Purchase treatment
            <ESelect aria-label={`Treatment for ${charge.property.name}`} value={treatment} onChange={(event) => setTreatment(event.target.value as Treatment)}>
              <option value="PENDING">Pending accounting review</option>
              <option value="AGENCY_DISBURSEMENT">Exact-cost client agency disbursement</option>
              <option value="RECHARGE">Recharge to client</option>
            </ESelect>
          </label>
        </div>
        <p aria-live="polite" className={cn("text-[0.75rem]", MUTED)}>
          Unsaved time preview: <b>{preview == null ? "enter minutes and a client rate" : money(preview)}</b>. Not approved or saved; purchase costs are checked again when you save. Agency disbursement is only for buying as the client&apos;s agent; it is outside sales income and the GST base.
        </p>
        <label className="block text-[0.8125rem]">
          Review note <span className={MUTED}>{noteRequired ? "required for an agency disbursement or a waived cost" : "optional for a recharge"}</span>
          <EInput value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
        </label>
      </fieldset>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error} Your entries are kept.</p> : null}
      {busy ? <p role="status" className={cn("text-[0.8125rem]", MUTED)}>Saving…</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <EButton size="sm" variant="outline" disabled={busy} onClick={() => void save("DRAFT")}>Save, still to review</EButton>
        <EButton size="sm" disabled={busy || treatment === "PENDING" || (Number(minutes) > 0 && !rate.trim()) || (noteRequired && note.trim().length < 3)} onClick={() => void save("APPROVED")}>Approve for next invoice</EButton>
        <span className={cn("min-w-0 flex-1 text-[0.75rem]", MUTED)}>Fields lock while saving. If someone else changed this charge meanwhile, the save is refused and your entries stay.</span>
      </div>
    </EToneCard>
  );
}
