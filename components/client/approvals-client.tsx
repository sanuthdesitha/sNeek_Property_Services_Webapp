"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type ApprovalRow = {
  id: string;
  version: string;
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

function validVersion(version: unknown): version is string {
  return typeof version === "string" && /^[a-f0-9]{64}$/.test(version);
}

export function ClientApprovalsClient() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const saving = useRef(false);
  const [stale, setStale] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function loadRows() {
    setLoading(true);
    try {
      const res = await fetch("/api/client/approvals", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load approvals.");
      const body = await res.json();
      if (!Array.isArray(body) || body.some((row) => !row || typeof row !== "object")) {
        throw new Error("Invalid approvals response.");
      }
      setRows(body as ApprovalRow[]);
      setStale(false);
      setLoadError(null);
    } catch {
      setLoadError("Approvals unavailable. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
  }, []);

  async function respond(id: string, decision: "APPROVE" | "DECLINE") {
    const row = rows.find((row) => row.id === id);
    if (saving.current || loading || loadError || stale || row?.status !== "PENDING" || !validVersion(row.version)) return;
    saving.current = true;
    setSavingId(id);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/client/approvals/${encodeURIComponent(id)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          expectedVersion: row.version,
          responseNote: noteById[id]?.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body?.code === "STALE_APPROVAL") {
        setStale(true);
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? "Could not submit your response.");
      toast({
        title: decision === "APPROVE" ? "Approval accepted" : "Approval declined",
      });
      await loadRows();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not submit your response.");
    } finally {
      saving.current = false;
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approval Requests"
        description="Review and approve optional extras before work is billed."
        actions={
          <Button variant="outline" disabled={loading || savingId !== null} onClick={loadRows}>
            Refresh
          </Button>
        }
      />

      {stale ? <p role="alert">Approval terms have changed. Refresh and review the updated terms before submitting another decision. Your notes have been preserved.</p> : null}
      {loadError ? <p role="alert">{loadError}</p> : null}
      {submitError ? <p role="alert">{submitError}</p> : null}

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading approval requests...
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (loadError ? null : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No approval requests found.
          </CardContent>
        </Card>
      )) : (
        rows.map((row) => {
          const pending = row.status === "PENDING";
          return (
            <Card key={row.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span>{row.title}</span>
                  <Badge
                    variant={
                      row.status === "APPROVED"
                        ? "success"
                        : row.status === "DECLINED"
                          ? "destructive"
                          : row.status === "PENDING"
                            ? ("warning" as any)
                            : "secondary"
                    }
                  >
                    {row.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{row.description || "No extra description provided."}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Amount:{" "}
                    <strong className="text-foreground">
                      {row.currency} {row.amount.toFixed(2)}
                    </strong>
                  </span>
                  <span>Requested: {format(new Date(row.requestedAt), "dd MMM yyyy HH:mm")}</span>
                  {row.expiresAt ? (
                    <span>Expires: {format(new Date(row.expiresAt), "dd MMM yyyy HH:mm")}</span>
                  ) : null}
                  {row.property ? <span>Property: {row.property.name}</span> : null}
                </div>

                {pending ? (
                  <div className="space-y-2 rounded-lg border p-3">
                    {!validVersion(row.version) ? <p role="alert">Approval terms could not be verified. Refresh before making a decision.</p> : null}
                    <label htmlFor={`approval-note-${row.id}`} className="text-xs font-medium">Optional note</label>
                    <Textarea
                      id={`approval-note-${row.id}`}
                      value={noteById[row.id] ?? ""}
                      onChange={(event) =>
                        setNoteById((prev) => ({ ...prev, [row.id]: event.target.value }))
                      }
                      rows={3}
                      placeholder="Add context for your decision..."
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={savingId !== null || loading || !!loadError || stale || !validVersion(row.version)}
                        onClick={() => respond(row.id, "APPROVE")}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        disabled={savingId !== null || loading || !!loadError || stale || !validVersion(row.version)}
                        onClick={() => respond(row.id, "DECLINE")}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Decline
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-4 w-4" />
                      Decision submitted.
                    </div>
                    {row.responseNote ? (
                      <p className="mt-2 whitespace-pre-wrap">{row.responseNote}</p>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
