"use client";

/**
 * "Review bonus" from a cleaner row. Accountability bonuses are proposed by
 * the nightly job under the existing streak and monthly-ranking rules
 * (lib/accountability/streaks.ts) as PENDING pay adjustments; a quality bonus
 * can also be proposed by hand from the row ("Propose bonus"). This dialog
 * offers the same decision the Approvals centre's Bonuses queue offers, through
 * the same endpoint (PATCH /api/admin/pay-adjustments/[id]). Nothing is
 * proposed or paid from here.
 */
import * as React from "react";
import Link from "next/link";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EModal } from "@/components/v2/admin/estate-kit";
import type { CleanerRow } from "./hub-types";
import { formatIssueDate } from "../issues/issue-format";

type Decision = "APPROVED" | "REJECTED";
type RowOutcome = { decision: Decision } | { error: string };

function amountText(amount: number | null): string {
  return typeof amount === "number" ? `$${amount.toFixed(2)}` : "Amount not recorded";
}

export function BonusDialog({
  row,
  timeZone,
  onClose,
  onDecided,
}: {
  row: CleanerRow;
  timeZone: string;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [outcomes, setOutcomes] = React.useState<Record<string, RowOutcome>>({});

  async function decide(id: string, decision: Decision) {
    setBusyId(id);
    try {
      const response = await fetch(`/api/admin/pay-adjustments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = (body as { error?: unknown }).error;
        setOutcomes((previous) => ({ ...previous, [id]: { error: typeof error === "string" && error ? error : "Not saved." } }));
        return;
      }
      setOutcomes((previous) => ({ ...previous, [id]: { decision } }));
      toast({ title: decision === "APPROVED" ? "Bonus approved" : "Bonus declined" });
      onDecided();
    } catch (cause) {
      setOutcomes((previous) => ({ ...previous, [id]: { error: cause instanceof Error ? cause.message : "Not saved." } }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <EModal open onClose={busyId ? () => undefined : onClose} eyebrow="Bonus proposals" title={`Review bonus · ${row.name}`}>
      <div className="space-y-4">
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          Each proposal is either automatic (the streak and monthly ranking rules) or proposed by hand from Quality. Approving
          adds it to the next pay run; declining removes the proposal.
        </p>
        <ul className="space-y-2">
          {row.pendingBonuses.map((bonus) => {
            const outcome = outcomes[bonus.id];
            const decided = outcome && "decision" in outcome ? outcome.decision : null;
            return (
              <li key={bonus.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-[600]">{bonus.title}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {amountText(bonus.amount)} · {bonus.origin === "manual" ? "proposed by hand" : "proposed automatically"}{" "}
                    {formatIssueDate(bonus.createdAt, timeZone)}
                  </p>
                  {outcome && "error" in outcome ? (
                    <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">
                      {outcome.error}
                    </p>
                  ) : null}
                </div>
                {decided ? (
                  <EPill tone={decided === "APPROVED" ? "ok" : "neutral"}>{decided === "APPROVED" ? "Approved" : "Declined"}</EPill>
                ) : (
                  <div className="flex gap-2">
                    <EButton size="sm" variant="outline" disabled={busyId !== null} onClick={() => void decide(bonus.id, "REJECTED")}>
                      Decline
                    </EButton>
                    <EButton size="sm" disabled={busyId !== null} onClick={() => void decide(bonus.id, "APPROVED")}>
                      {busyId === bonus.id ? "Saving…" : "Approve"}
                    </EButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/v2/admin/approvals" className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            All approvals
          </Link>
          <EButton size="sm" variant="outline" onClick={onClose} disabled={busyId !== null}>
            Close
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
