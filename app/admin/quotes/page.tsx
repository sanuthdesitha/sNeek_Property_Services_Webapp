"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Plus, Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, "secondary" | "default" | "success" | "destructive" | "outline"> = {
  DRAFT: "secondary",
  SENT: "default",
  ACCEPTED: "success",
  DECLINED: "destructive",
  CONVERTED: "outline",
};

export default function QuotesPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [editQuote, setEditQuote] = useState<any | null>(null);
  const [savingQuote, setSavingQuote] = useState(false);
  const [deleteQuote, setDeleteQuote] = useState<any | null>(null);
  const [deletingQuote, setDeletingQuote] = useState(false);
  const [cloningQuoteId, setCloningQuoteId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    status: "DRAFT",
    validUntil: "",
    notes: "",
  });

  function loadData() {
    fetch("/api/admin/leads")
      .then((r) => r.json())
      .then((data) => setLeads(Array.isArray(data) ? data : []));

    fetch("/api/admin/quotes")
      .then((r) => r.json())
      .then((data) => setQuotes(Array.isArray(data) ? data : []));
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!editQuote) return;
    setEditForm({
      status: editQuote.status ?? "DRAFT",
      validUntil: editQuote.validUntil ? new Date(editQuote.validUntil).toISOString().slice(0, 10) : "",
      notes: editQuote.notes ?? "",
    });
  }, [editQuote]);

  async function sendQuote(id: string, defaultEmail?: string | null) {
    const recipient = window.prompt("Send quote to email:", defaultEmail ?? "");
    if (!recipient) return;

    const res = await fetch(`/api/admin/quotes/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipient }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Send failed", description: body.error ?? "Could not send quote.", variant: "destructive" });
      return;
    }

    toast({ title: "Quote sent", description: `Sent to ${recipient}` });
    loadData();
  }

  async function updateQuote() {
    if (!editQuote) return;
    setSavingQuote(true);
    const payload = {
      status: editForm.status,
      notes: editForm.notes || null,
      validUntil: editForm.validUntil ? new Date(`${editForm.validUntil}T00:00:00`).toISOString() : null,
    };
    const res = await fetch(`/api/admin/quotes/${editQuote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingQuote(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not update quote.", variant: "destructive" });
      return;
    }
    toast({ title: "Quote updated" });
    setEditQuote(null);
    loadData();
  }

  async function cloneQuote(quote: any) {
    setCloningQuoteId(quote.id);
    const payload = {
      leadId: quote.leadId || undefined,
      clientId: quote.clientId || undefined,
      serviceType: quote.serviceType,
      lineItems: Array.isArray(quote.lineItems) ? quote.lineItems : [],
      subtotal: Number(quote.subtotal ?? 0),
      gstAmount: Number(quote.gstAmount ?? 0),
      totalAmount: Number(quote.totalAmount ?? 0),
      notes: quote.notes ?? undefined,
      validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString() : undefined,
    };
    const res = await fetch("/api/admin/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setCloningQuoteId(null);
    if (!res.ok) {
      toast({ title: "Clone failed", description: body.error ?? "Could not clone quote.", variant: "destructive" });
      return;
    }
    toast({ title: "Quote template copy created" });
    loadData();
  }

  async function removeQuote() {
    if (!deleteQuote) return;
    setDeletingQuote(true);
    const res = await fetch(`/api/admin/quotes/${deleteQuote.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setDeletingQuote(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete quote.", variant: "destructive" });
      return;
    }
    toast({ title: "Quote deleted" });
    setDeleteQuote(null);
    loadData();
  }

  async function downloadQuotePdf(id: string) {
    const res = await fetch(`/api/admin/quotes/${id}/pdf`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Download failed", description: body.error ?? "Could not export PDF.", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quote-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Quotes and Leads</h2>
        <Button asChild>
          <Link href="/admin/quotes/new">
            <Plus className="mr-2 h-4 w-4" />
            New Quote
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">Leads ({leads.length})</TabsTrigger>
          <TabsTrigger value="quotes">Quotes ({quotes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="leads">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {leads.map((lead) => (
                  <div key={lead.id} className="flex items-center justify-between px-6 py-3">
                    <div>
                      <p className="text-sm font-medium">{lead.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {lead.email} - {lead.serviceType?.replace(/_/g, " ")} - {lead.suburb}
                      </p>
                      {lead.estimateMin ? (
                        <p className="text-xs text-muted-foreground">
                          Est: {formatCurrency(lead.estimateMin)} - {formatCurrency(lead.estimateMax ?? 0)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{format(new Date(lead.createdAt), "dd MMM")}</span>
                      <Badge variant={lead.status === "NEW" ? ("warning" as any) : "secondary"} className="text-xs">
                        {lead.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {leads.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No leads yet. They will appear here from the public quote page.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quotes">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {quotes.map((q) => (
                  <div key={q.id} className="flex items-center justify-between px-6 py-3">
                    <div>
                      <p className="text-sm font-medium">{q.client?.name ?? q.lead?.name ?? "Direct quote"}</p>
                      <p className="text-xs text-muted-foreground">
                        {q.serviceType?.replace(/_/g, " ")} - {format(new Date(q.createdAt), "dd MMM yyyy")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{formatCurrency(q.totalAmount)}</span>
                      <Button size="sm" variant="outline" onClick={() => downloadQuotePdf(q.id)}>
                        PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendQuote(q.id, q.client?.email ?? q.lead?.email ?? null)}
                      >
                        Email
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditQuote(q)}>
                        <Pencil className="mr-1 h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cloningQuoteId === q.id}
                        onClick={() => cloneQuote(q)}
                      >
                        <Copy className="mr-1 h-4 w-4" />
                        {cloningQuoteId === q.id ? "Saving..." : "Save as template"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteQuote(q)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Delete
                      </Button>
                      {q.status !== "CONVERTED" && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/quotes/${q.id}/convert`}>Convert</Link>
                        </Button>
                      )}
                      <Badge variant={STATUS_COLORS[q.status] ?? "secondary"}>{q.status}</Badge>
                      {q.status === "DRAFT" && (
                        <span className="text-xs text-muted-foreground">Pending admin approval</span>
                      )}
                    </div>
                  </div>
                ))}
                {quotes.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No quotes yet.</p> : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(editQuote)} onOpenChange={(open) => !open && setEditQuote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(value) => setEditForm((prev) => ({ ...prev, status: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(STATUS_COLORS).map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Valid until</Label>
              <Input
                type="date"
                value={editForm.validUntil}
                onChange={(e) => setEditForm((prev) => ({ ...prev, validUntil: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditQuote(null)} disabled={savingQuote}>
                Cancel
              </Button>
              <Button onClick={updateQuote} disabled={savingQuote}>
                {savingQuote ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog
        open={Boolean(deleteQuote)}
        onOpenChange={(open) => !open && setDeleteQuote(null)}
        title="Delete quote"
        description="This permanently removes the quote record."
        confirmLabel="Delete quote"
        loading={deletingQuote}
        onConfirm={removeQuote}
      />
    </div>
  );
}

