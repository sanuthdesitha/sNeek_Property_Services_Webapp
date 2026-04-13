"use client";

import { useState } from "react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useBasicConfirmDialog } from "@/components/shared/use-basic-confirm";

type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  audience: any;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number | null;
  createdAt: string;
  createdBy: { name: string | null; email: string };
};

type FormState = {
  name: string;
  subject: string;
  htmlBody: string;
  audienceType: "all_clients" | "inactive_clients" | "service_type";
  inactiveDays: string;
  jobTypes: string[];
  status: "draft" | "scheduled";
  scheduledAt: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  subject: "",
  htmlBody: "<p>Hello from sNeek.</p>",
  audienceType: "all_clients",
  inactiveDays: "60",
  jobTypes: [],
  status: "draft",
  scheduledAt: "",
};

function toInputDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formFromCampaign(row: CampaignRow): FormState {
  const audience = row.audience && typeof row.audience === "object" ? row.audience : {};
  const filters = audience.filters && typeof audience.filters === "object" ? audience.filters : {};
  return {
    name: row.name,
    subject: row.subject,
    htmlBody: row.htmlBody,
    audienceType: audience.type === "inactive_clients" || audience.type === "service_type" ? audience.type : "all_clients",
    inactiveDays: filters.daysSinceLastBooking ? String(filters.daysSinceLastBooking) : "60",
    jobTypes: Array.isArray(filters.jobTypes) ? filters.jobTypes : [],
    status: row.status === "scheduled" ? "scheduled" : "draft",
    scheduledAt: toInputDateTime(row.scheduledAt),
  };
}

export function EmailCampaignsWorkspace({ initialCampaigns }: { initialCampaigns: CampaignRow[] }) {
  const { confirm, dialog } = useBasicConfirmDialog();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function buildPayload() {
    return {
      name: form.name,
      subject: form.subject,
      htmlBody: form.htmlBody,
      audience: {
        type: form.audienceType,
        filters:
          form.audienceType === "inactive_clients"
            ? { daysSinceLastBooking: Number(form.inactiveDays || 60) }
            : form.audienceType === "service_type"
              ? { jobTypes: form.jobTypes }
              : {},
      },
      status: form.status,
      scheduledAt: form.status === "scheduled" && form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
    };
  }

  async function saveCampaign() {
    setSaving(true);
    try {
      const response = await fetch(editingId ? `/api/admin/email-campaigns/${editingId}` : "/api/admin/email-campaigns", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not save campaign.");
      const campaign = body.campaign as CampaignRow;
      setCampaigns((current) => {
        const next = editingId ? current.map((item) => (item.id === campaign.id ? campaign : item)) : [campaign, ...current];
        return [...next].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
      });
      toast({ title: editingId ? "Campaign updated" : "Campaign created" });
      resetForm();
    } catch (error: any) {
      toast({ title: "Save failed", description: error?.message ?? "Could not save campaign.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function sendCampaign(id: string) {
    setSendingId(id);
    try {
      const response = await fetch(`/api/admin/email-campaigns/${id}/send`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not send campaign.");
      setCampaigns((current) => current.map((item) => item.id === id ? { ...item, status: "sent", sentAt: new Date().toISOString(), recipientCount: body.sent ?? item.recipientCount } : item));
      toast({ title: "Campaign sent", description: `${body.sent ?? 0} recipient(s) processed.` });
    } catch (error: any) {
      toast({ title: "Send failed", description: error?.message ?? "Could not send campaign.", variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  }

  async function deleteCampaign(id: string) {
    const approved = await confirm({
      title: "Delete email campaign",
      description: "This will remove the saved campaign from the marketing workspace.",
      confirmLabel: "Delete campaign",
      actionKey: "deleteCampaign",
    });
    if (!approved) return;
    try {
      const response = await fetch(`/api/admin/email-campaigns/${id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not delete campaign.");
      setCampaigns((current) => current.filter((item) => item.id !== id));
      if (editingId === id) resetForm();
      toast({ title: "Campaign deleted" });
    } catch (error: any) {
      toast({ title: "Delete failed", description: error?.message ?? "Could not delete campaign.", variant: "destructive" });
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      {dialog}
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit email campaign" : "New email campaign"}</CardTitle>
          <CardDescription>Create one-off or scheduled client email campaigns using the live client database.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Campaign name" />
          </div>
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Subject line" />
          </div>
          <div className="space-y-2">
            <Label>Audience</Label>
            <Select value={form.audienceType} onValueChange={(value: FormState['audienceType']) => setForm((current) => ({ ...current, audienceType: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_clients">All active clients</SelectItem>
                <SelectItem value="inactive_clients">Inactive clients</SelectItem>
                <SelectItem value="service_type">Clients by service type</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.audienceType === "inactive_clients" ? (
            <div className="space-y-2">
              <Label>No booking for at least X days</Label>
              <Input type="number" min="1" step="1" value={form.inactiveDays} onChange={(event) => setForm((current) => ({ ...current, inactiveDays: event.target.value }))} />
            </div>
          ) : null}
          {form.audienceType === "service_type" ? (
            <div className="space-y-2">
              <Label>Service types</Label>
              <div className="grid gap-2 rounded-2xl border p-3 md:grid-cols-2">
                {MARKETED_SERVICES.map((service) => {
                  const checked = form.jobTypes.includes(service.jobType);
                  return (
                    <label key={service.jobType} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => setForm((current) => ({
                          ...current,
                          jobTypes: value === true ? [...current.jobTypes, service.jobType] : current.jobTypes.filter((item) => item !== service.jobType),
                        }))}
                      />
                      <span>{service.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value: FormState['status']) => setForm((current) => ({ ...current, status: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Schedule at</Label>
              <Input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))} disabled={form.status !== "scheduled"} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>HTML body</Label>
            <Textarea rows={12} value={form.htmlBody} onChange={(event) => setForm((current) => ({ ...current, htmlBody: event.target.value }))} placeholder="<p>Hello from sNeek...</p>" />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetForm}>Reset</Button>
            <Button type="button" onClick={saveCampaign} disabled={saving || !form.name.trim() || !form.subject.trim() || !form.htmlBody.trim()}>{saving ? "Saving..." : editingId ? "Save changes" : "Create campaign"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
          <CardDescription>Draft, scheduled, and sent client email campaigns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {campaigns.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No email campaigns yet.</div>
          ) : (
            campaigns.map((campaign) => (
              <div key={campaign.id} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground">{campaign.subject}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Status: {campaign.status.replace(/_/g, " ")}{campaign.scheduledAt ? ` | Scheduled ${new Date(campaign.scheduledAt).toLocaleString()}` : ""}{campaign.sentAt ? ` | Sent ${new Date(campaign.sentAt).toLocaleString()}` : ""}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Recipients processed: {campaign.recipientCount ?? 0}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setEditingId(campaign.id); setForm(formFromCampaign(campaign)); }}>Edit</Button>
                    <Button size="sm" onClick={() => sendCampaign(campaign.id)} disabled={sendingId === campaign.id}>{sendingId === campaign.id ? "Sending..." : "Send now"}</Button>
                    <Button variant="destructive" size="sm" onClick={() => deleteCampaign(campaign.id)}>Delete</Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
