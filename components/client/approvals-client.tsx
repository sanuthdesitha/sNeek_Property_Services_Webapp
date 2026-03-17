"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

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

export function ClientApprovalsClient() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  async function loadRows() {
    setLoading(true);
    const res = await fetch("/api/client/approvals");
    const body = await res.json().catch(() => []);
    setRows(Array.isArray(body) ? (body as ApprovalRow[]) : []);
    setLoading(false);
  }

  useEffect(() => {
    loadRows();
  }, []);

  async function respond(id: string, decision: "APPROVE" | "DECLINE") {
    setSavingId(id);
    const res = await fetch(`/api/client/approvals/${id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        responseNote: noteById[id]?.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) {
      toast({
        title: "Response failed",
        description: body.error ?? "Could not submit your response.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: decision === "APPROVE" ? "Approval accepted" : "Approval declined",
    });
    await loadRows();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Approval Requests</h2>
          <p className="text-sm text-muted-foreground">
            Review and approve optional extras before work is billed.
          </p>
        </div>
        <Button variant="outline" onClick={loadRows}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading approval requests...
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No approval requests found.
          </CardContent>
        </Card>
      ) : (
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
                    <label className="text-xs font-medium">Optional note</label>
                    <Textarea
                      value={noteById[row.id] ?? ""}
                      onChange={(event) =>
                        setNoteById((prev) => ({ ...prev, [row.id]: event.target.value }))
                      }
                      rows={3}
                      placeholder="Add context for your decision..."
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={savingId === row.id}
                        onClick={() => respond(row.id, "APPROVE")}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        disabled={savingId === row.id}
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
