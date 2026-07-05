"use client";

/**
 * Estate approvals board — same endpoints as the legacy approvals page:
 *   GET  /api/client/approvals                       → ApprovalRow[]
 *   POST /api/client/approvals/[id]/respond          { decision: "APPROVE"|"DECLINE", responseNote? }
 */
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Loader2, RotateCw, X } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import { EInlineNotice, ELabel, ETextarea } from "@/components/v2/client/fields";

type ApprovalRow = {
  id: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED" | "EXPIRED";
  requestedAt: string;
  expiresAt: string | null;
  responseNote: string | null;
  property: { name: string; suburb: string } | null;
  job: { id: string; jobType: string; scheduledDate: string; property: { name: string } } | null;
};

function statusTone(status: ApprovalRow["status"]): "success" | "danger" | "warning" | "neutral" {
  switch (status) {
    case "APPROVED":
      return "success";
    case "DECLINED":
      return "danger";
    case "PENDING":
      return "warning";
    default:
      return "neutral";
  }
}

function money(amount: number, currency: string) {
  return `${currency} ${Number(amount).toFixed(2)}`;
}

export function ClientApprovalsBoard() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const loadRows = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/client/approvals", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      if (!res.ok) throw new Error((body as any)?.error ?? "Could not load approvals.");
      setRows(Array.isArray(body) ? (body as ApprovalRow[]) : []);
    } catch (err: any) {
      setLoadError(err?.message ?? "Could not load approvals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  async function respond(id: string, decision: "APPROVE" | "DECLINE") {
    setSavingId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/client/approvals/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          responseNote: noteById[id]?.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not submit your response.");
      await loadRows();
    } catch (err: any) {
      setErrorById((prev) => ({ ...prev, [id]: err?.message ?? "Could not submit your response." }));
    } finally {
      setSavingId(null);
    }
  }

  const pending = rows.filter((row) => row.status === "PENDING");
  const history = rows.filter((row) => row.status !== "PENDING");

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading approval requests…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {loadError ? (
        <div className="flex items-center justify-between gap-3">
          <EInlineNotice tone="danger">{loadError}</EInlineNotice>
          <EButton variant="outline" size="sm" onClick={loadRows}>
            <RotateCw className="h-3.5 w-3.5" /> Retry
          </EButton>
        </div>
      ) : null}

      {/* Pending */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <EEyebrow>Awaiting your decision</EEyebrow>
          <span className="e-numeral text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
            {pending.length}
          </span>
        </div>

        {pending.length === 0 ? (
          <EEmptyState
            eyebrow="All clear"
            title="Nothing awaiting approval"
            description="Optional extras appear here before any work is billed to your account."
          />
        ) : (
          pending.map((row) => (
            <ECard key={row.id} variant="ceremony">
              <ECardBody className="space-y-4 pt-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="e-display-sm">{row.title}</p>
                    <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                      {row.description || "No extra description provided."}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <span>Requested {format(new Date(row.requestedAt), "d MMM yyyy HH:mm")}</span>
                      {row.expiresAt ? (
                        <span>Expires {format(new Date(row.expiresAt), "d MMM yyyy HH:mm")}</span>
                      ) : null}
                      {row.property ? <span>{row.property.name}</span> : null}
                      {row.job ? (
                        <span>
                          {row.job.jobType.replace(/_/g, " ").toLowerCase()} ·{" "}
                          {format(new Date(row.job.scheduledDate), "d MMM yyyy")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="e-numeral text-[1.5rem] leading-none">{money(row.amount, row.currency)}</p>
                    <p className="mt-1 text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">
                      if approved
                    </p>
                  </div>
                </div>

                <EThread />

                <div className="space-y-2">
                  <ELabel htmlFor={`approval-note-${row.id}`}>Optional note</ELabel>
                  <ETextarea
                    id={`approval-note-${row.id}`}
                    value={noteById[row.id] ?? ""}
                    onChange={(event) =>
                      setNoteById((prev) => ({ ...prev, [row.id]: event.target.value }))
                    }
                    rows={2}
                    placeholder="Add context for your decision…"
                  />
                  {errorById[row.id] ? (
                    <EInlineNotice tone="danger">{errorById[row.id]}</EInlineNotice>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <EButton
                      variant="outline"
                      size="sm"
                      disabled={savingId === row.id}
                      onClick={() => respond(row.id, "DECLINE")}
                    >
                      <X className="h-3.5 w-3.5" /> Decline
                    </EButton>
                    <EButton
                      variant="gold"
                      size="sm"
                      disabled={savingId === row.id}
                      onClick={() => respond(row.id, "APPROVE")}
                    >
                      {savingId === row.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Approve
                    </EButton>
                  </div>
                </div>
              </ECardBody>
            </ECard>
          ))
        )}
      </section>

      {/* History */}
      {history.length > 0 ? (
        <section className="space-y-3">
          <EEyebrow>History</EEyebrow>
          <ECard>
            <ECardBody className="space-y-1 pt-5">
              {history.map((row, i) => (
                <div key={row.id}>
                  {i > 0 ? <EThread className="my-1" /> : null}
                  <div className="flex flex-wrap items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-medium">{row.title}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {format(new Date(row.requestedAt), "d MMM yyyy")}
                        {row.property ? ` · ${row.property.name}` : ""}
                      </p>
                      {row.responseNote ? (
                        <p className="mt-1 whitespace-pre-wrap text-[0.75rem] italic text-[hsl(var(--e-text-secondary))]">
                          “{row.responseNote}”
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <p className="e-numeral text-[0.9375rem]">{money(row.amount, row.currency)}</p>
                      <EBadge tone={statusTone(row.status)} soft>
                        {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                      </EBadge>
                    </div>
                  </div>
                </div>
              ))}
            </ECardBody>
          </ECard>
        </section>
      ) : null}
    </div>
  );
}
