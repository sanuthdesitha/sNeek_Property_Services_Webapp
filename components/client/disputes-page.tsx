"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd MMM yyyy, h:mm a");
}

function formatDateOnly(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd MMM yyyy");
}

export function ClientDisputesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    amountDisputed: "0",
  });

  async function load() {
    setLoading(true);
    const res = await fetch("/api/client/disputes");
    const body = await res.json().catch(() => []);
    setRows(Array.isArray(body) ? body : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createDispute() {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/client/disputes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        amountDisputed: Number(form.amountDisputed || 0),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Could not create dispute", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setForm({ title: "", description: "", amountDisputed: "0" });
    load();
  }

  async function addComment(id: string) {
    const comment = window.prompt("Add comment");
    if (!comment?.trim()) return;
    const res = await fetch(`/api/client/disputes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Could not add comment", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Disputes</h2>
        <p className="text-sm text-muted-foreground">Raise and track billing/report disputes.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open Dispute</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
          <Textarea rows={3} placeholder="Description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
          <div className="flex gap-2">
            <Input type="number" min={0} step="0.01" value={form.amountDisputed} onChange={(e) => setForm((prev) => ({ ...prev, amountDisputed: e.target.value }))} />
            <Button onClick={createDispute} disabled={saving}>{saving ? "Submitting..." : "Submit"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading disputes...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No disputes found.</p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{row.title}</p>
                  <Badge variant={row.status === "OPEN" ? "warning" : row.status === "RESOLVED" ? "success" : "secondary"}>
                    {row.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>

                <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <p>
                    <strong className="text-foreground">Property:</strong>{" "}
                    {row.property?.name ?? row.job?.property?.name ?? "-"}
                  </p>
                  <p>
                    <strong className="text-foreground">Service date:</strong>{" "}
                    {formatDateOnly(row.job?.scheduledDate)}
                  </p>
                  <p>
                    <strong className="text-foreground">Opened:</strong>{" "}
                    {formatDateTime(row.createdAt)}
                  </p>
                  <p>
                    <strong className="text-foreground">Last update:</strong>{" "}
                    {formatDateTime(row.updatedAt)}
                  </p>
                  <p>
                    <strong className="text-foreground">Amount:</strong>{" "}
                    {row.amountDisputed != null
                      ? `${row.currency ?? "AUD"} ${Number(row.amountDisputed).toFixed(2)}`
                      : "-"}
                  </p>
                  <p>
                    <strong className="text-foreground">Priority:</strong> {row.priority ?? "-"}
                  </p>
                  <p>
                    <strong className="text-foreground">Job ref:</strong> {row.jobId ?? "-"}
                  </p>
                  <p>
                    <strong className="text-foreground">Invoice ref:</strong> {row.invoiceRef ?? "-"}
                  </p>
                  {row.resolvedAt ? (
                    <p className="sm:col-span-2">
                      <strong className="text-foreground">Resolved:</strong>{" "}
                      {formatDateTime(row.resolvedAt)}
                    </p>
                  ) : null}
                </div>

                {Array.isArray(row.comments) && row.comments.length > 0 ? (
                  <div className="mt-3 rounded-md border bg-muted/30 p-2">
                    <p className="mb-2 text-xs font-medium text-foreground">Comments</p>
                    <div className="space-y-2">
                      {row.comments.map((comment: any) => (
                        <div key={comment.id} className="rounded bg-background p-2">
                          <p className="text-xs text-muted-foreground">
                            {(comment.author?.name || comment.author?.email || "User")} - {formatDateTime(comment.createdAt)}
                          </p>
                          <p className="text-xs">{comment.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-2">
                  <Button variant="outline" size="sm" onClick={() => addComment(row.id)}>
                    Add comment
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
