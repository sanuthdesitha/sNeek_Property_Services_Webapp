"use client";

/**
 * Wave F: the office's "can you buy …" asks, on the cleaner's job screen (for
 * this job and its property) and on Supplies → Shopping (all of them). The
 * cleaner accepts (the item goes on their own shopping run, where they record
 * the purchase and the receipt; the office approves the reimbursement) or
 * declines with an optional note. Hidden when there is nothing to answer.
 */
import * as React from "react";
import Link from "next/link";
import { EAlert, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/cleaner/fields";
import type { CleanerAskRow } from "@/lib/inventory/urgent-stock-ask-view";
import { PURCHASE_ASK_LABEL } from "@/lib/inventory/urgent-stock-ask-state";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; asks: CleanerAskRow[] };

export function PurchaseAsksCard({ jobId }: { jobId?: string }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [revision, setRevision] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [declining, setDeclining] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [message, setMessage] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
    fetch(`/api/cleaner/urgent-stock/asks${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { asks?: CleanerAskRow[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.asks) throw new Error(body?.error ?? "Could not load requests from the office.");
        setLoad({ status: "ready", asks: body.asks });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load requests from the office." });
      });
    return () => controller.abort();
  }, [jobId, revision]);

  // A different job: drop the half-typed decline of the old one.
  React.useEffect(() => {
    setDeclining(null);
    setNote("");
    setMessage(null);
  }, [jobId]);

  async function answer(askId: string, decision: "accept" | "decline") {
    setBusy(askId);
    setMessage(null);
    try {
      const response = await fetch(`/api/cleaner/urgent-stock/asks/${encodeURIComponent(askId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: decision === "decline" ? note.trim() || null : null }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Your answer was not saved.");
      setMessage({ tone: "success", text: decision === "accept" ? "Added to your shopping run. Record what you buy and attach the receipt there." : "Declined. The office has been told." });
      setDeclining(null);
      setNote("");
      setRevision((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Your answer was not saved." });
    } finally {
      setBusy(null);
    }
  }

  if (load.status === "loading") return null;
  if (load.status === "error") return <EAlert tone="danger">{load.message}</EAlert>;
  if (load.asks.length === 0 && !message) return null;

  return (
    <ECard>
      <ECardBody className="space-y-3">
        <h2 className="text-[0.9375rem] font-[600]">Can you buy these?</h2>
        {message ? <EAlert tone={message.tone}>{message.text}</EAlert> : null}
        <ul className="space-y-3">
          {load.asks.map((ask) => (
            <li key={ask.id} className="space-y-2 rounded-lg border border-[hsl(var(--e-border))] p-3 text-[0.875rem]">
              <p><span className="font-[600]">{ask.quantity ?? "?"} {ask.unit} {ask.itemName}</span> for {ask.propertyName}</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Asked by {ask.askedByName}{ask.note ? ` — “${ask.note}”` : ""} · {PURCHASE_ASK_LABEL[ask.state]}</p>
              {ask.state === "ASKED" ? (
                declining === ask.id ? (
                  <fieldset disabled={busy === ask.id} className="space-y-2">
                    <ETextarea aria-label="Why you cannot buy it (optional)" placeholder="Why you cannot buy it (optional)" maxLength={1000} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
                    <div className="flex flex-wrap gap-2">
                      <EButton size="sm" variant="danger" onClick={() => void answer(ask.id, "decline")}>{busy === ask.id ? "Saving…" : "Decline"}</EButton>
                      <EButton size="sm" variant="ghost" onClick={() => setDeclining(null)}>Back</EButton>
                    </div>
                  </fieldset>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <EButton size="sm" disabled={busy !== null} onClick={() => void answer(ask.id, "accept")}>{busy === ask.id ? "Saving…" : "Accept"}</EButton>
                    <EButton size="sm" variant="outline" disabled={busy !== null} onClick={() => setDeclining(ask.id)}>Decline</EButton>
                  </div>
                )
              ) : (
                <Link className="text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] hover:underline" href="/v2/cleaner/supplies?tab=shopping">Open my shopping runs</Link>
              )}
            </li>
          ))}
        </ul>
      </ECardBody>
    </ECard>
  );
}
