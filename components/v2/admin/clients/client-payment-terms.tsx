"use client";

/**
 * Payment terms for one client on the Client 360 page: the client's own terms
 * (0–120 days) or the organisation default. PATCH
 * /api/admin/clients/:id/payment-terms; audited server-side. Read-only for a
 * viewer who may not change terms (decided on the server and re-checked by
 * the route).
 *
 * Issued invoices keep the terms they were sent with, so this only changes the
 * due date of drafts, approved invoices and invoices sent from now on.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ECard, ECardBody, ECardHeader, ECardTitle, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { CLIENT_PAYMENT_TERMS_MAX_DAYS } from "@/lib/billing/invoice-due";

type Mode = "default" | "custom";

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

export function ClientPaymentTerms({
  clientId,
  paymentTermsDays,
  organisationDefaultDays,
  canEdit,
}: {
  clientId: string;
  paymentTermsDays: number | null;
  organisationDefaultDays: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(paymentTermsDays === null ? "default" : "custom");
  const [days, setDays] = useState<string>(paymentTermsDays === null ? String(organisationDefaultDays) : String(paymentTermsDays));
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  // A different client (or a refreshed value) resets the draft.
  useEffect(() => {
    setMode(paymentTermsDays === null ? "default" : "custom");
    setDays(paymentTermsDays === null ? String(organisationDefaultDays) : String(paymentTermsDays));
    setSave({ status: "idle" });
  }, [clientId, paymentTermsDays, organisationDefaultDays]);

  const parsed = Number(days);
  const validDays = /^\d{1,3}$/.test(days.trim()) && parsed >= 0 && parsed <= CLIENT_PAYMENT_TERMS_MAX_DAYS;
  const next: number | null = mode === "default" ? null : validDays ? parsed : null;
  const dirty = mode === "default" ? paymentTermsDays !== null : validDays && parsed !== paymentTermsDays;
  const saving = save.status === "saving";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || saving || (mode === "custom" && !validDays)) return;
    setSave({ status: "saving" });
    try {
      const res = await fetch(`/api/admin/clients/${encodeURIComponent(clientId)}/payment-terms`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentTermsDays: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSave({ status: "error", message: body.error ?? "Could not save payment terms." });
        return;
      }
      setSave({ status: "saved" });
      router.refresh();
    } catch {
      setSave({ status: "error", message: "Could not save payment terms. Check the connection and try again." });
    }
  }

  const current = paymentTermsDays === null ? `Organisation default (${organisationDefaultDays} days)` : `${paymentTermsDays} days`;

  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[0.95rem]">Payment terms</ECardTitle>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Days after an invoice is created that it falls due. Invoices already sent keep the terms they were sent with.
        </p>
      </ECardHeader>
      <ECardBody className="pt-0">
        {canEdit ? (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <EField label="Terms" className="min-w-[12rem]">
              <ESelect value={mode} disabled={saving} onChange={(event) => setMode(event.target.value as Mode)}>
                <option value="default">Organisation default ({organisationDefaultDays} days)</option>
                <option value="custom">This client&apos;s own terms</option>
              </ESelect>
            </EField>
            {mode === "custom" ? (
              <EField label="Days" hint={`0 to ${CLIENT_PAYMENT_TERMS_MAX_DAYS}`} className="w-28">
                <EInput
                  inputMode="numeric"
                  value={days}
                  disabled={saving}
                  aria-invalid={!validDays}
                  onChange={(event) => setDays(event.target.value)}
                />
              </EField>
            ) : null}
            <EButton type="submit" size="sm" variant="gold" disabled={!dirty || saving || (mode === "custom" && !validDays)}>
              {saving ? "Saving…" : "Save terms"}
            </EButton>
            <p role="status" aria-live="polite" className="basis-full text-[0.75rem]">
              {save.status === "saved" ? <span className="text-[hsl(var(--e-success))]">Saved. Now: {current}.</span> : null}
              {save.status === "error" ? <span className="text-[hsl(var(--e-danger))]">{save.message}</span> : null}
              {mode === "custom" && !validDays ? <span className="text-[hsl(var(--e-danger))]">Enter a whole number of days from 0 to {CLIENT_PAYMENT_TERMS_MAX_DAYS}.</span> : null}
            </p>
          </form>
        ) : (
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            {current}
            <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Only an administrator, or an operations manager who manages finance, can change this.</span>
          </p>
        )}
      </ECardBody>
    </ECard>
  );
}
