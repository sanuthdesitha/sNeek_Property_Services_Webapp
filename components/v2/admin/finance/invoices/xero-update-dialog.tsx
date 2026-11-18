"use client";

/**
 * "Update in Xero" confirmation (2026-11-18), shared by the invoice editor's
 * Xero card and the list's row menu.
 *
 * Tier A (ordinary) by default: one sentence and "Update in Xero". When the
 * server answers that Xero's total or line amounts differ from this invoice,
 * the dialog shows both totals and asks again at tier B (it overwrites what is
 * in Xero; focus starts on Cancel). The confirmation sends back the exact two
 * totals shown, so the server refuses if either changed meanwhile.
 *
 * One request key per dialog: a double-click, or a retry after a lost answer,
 * repeats the same attempt and is never applied twice. Xero's refusal is shown
 * in its words and the dialog stays open; nothing changes here on a refusal.
 */
import { useEffect, useRef, useState } from "react";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { toast } from "@/hooks/use-toast";
import { xeroUpdateRequest, type XeroUpdateConfirmation } from "./invoice-requests";

export type XeroUpdateTarget = { id: string; invoiceNumber: string; kind?: string | null };

type Phase =
  | { kind: "confirm" }
  | { kind: "overwrite"; localTotal: number; xeroTotal: number; message: string };

function newRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function money(value: number): string {
  return `$${Math.abs(value).toFixed(2)}`;
}

export function XeroUpdateDialog({ target, onClose, onDone }: { target: XeroUpdateTarget; onClose: () => void; onDone: () => void }) {
  const [requestKey] = useState(newRequestKey);
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const name = target.kind === "CREDIT_NOTE" ? "credit note" : "invoice";

  async function run(confirmTotals: XeroUpdateConfirmation | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await xeroUpdateRequest(target.id, requestKey, confirmTotals);
      if (!live.current) return;
      if (result.ok) {
        toast({ title: "Updated in Xero", description: result.body.message ?? `${target.invoiceNumber} was updated in Xero.` });
        onDone();
        onClose();
        return;
      }
      const body = result.body;
      if (body.code === "XERO_UPDATE_NEEDS_CONFIRMATION" && typeof body.localTotal === "number" && typeof body.xeroTotal === "number") {
        setPhase({ kind: "overwrite", localTotal: body.localTotal, xeroTotal: body.xeroTotal, message: body.error ?? "" });
        return;
      }
      setError(body.error === "FORBIDDEN" ? "You cannot do this here. Stop viewing as someone else and sign in as yourself." : body.error ?? "Xero was not updated.");
    } catch {
      if (live.current) setError("Could not reach the server. Whether Xero received the update is not known: check this invoice's History, then try again (it is not applied twice).");
    } finally {
      if (live.current) setBusy(false);
    }
  }

  if (phase.kind === "overwrite") {
    return (
      <EConfirmDialog
        open
        tier="destructive"
        onClose={() => !busy && onClose()}
        title={`Overwrite ${target.invoiceNumber} in Xero?`}
        description={
          <>
            <span className="block">
              Xero total <strong className="e-tnum">{money(phase.xeroTotal)}</strong>; this {name} <strong className="e-tnum">{money(phase.localTotal)}</strong>.
            </span>
            <span className="block">Xero&rsquo;s lines are replaced with this {name}&rsquo;s lines. This cannot be undone.</span>
          </>
        }
        confirmLabel="Overwrite in Xero"
        busy={busy}
        error={error}
        onConfirm={() => run({ localTotal: phase.localTotal, xeroTotal: phase.xeroTotal })}
      />
    );
  }

  return (
    <EConfirmDialog
      open
      tier="ordinary"
      onClose={() => !busy && onClose()}
      title={`Update ${target.invoiceNumber} in Xero?`}
      description={`Replaces the lines of the same Xero ${name} with these lines, grouped by property like the PDF. Amounts here are unchanged.`}
      confirmLabel={busy ? "Updating…" : "Update in Xero"}
      busy={busy}
      error={error}
      onConfirm={() => run(null)}
    />
  );
}
