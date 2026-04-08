"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";

type ClientDetail = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string | Date;
  leads: Array<{
    id: string;
    serviceType: string | null;
    estimateMin: number | null;
    estimateMax: number | null;
    status: string;
    createdAt: string | Date;
  }>;
  quotes: Array<{
    id: string;
    status: string;
    totalAmount: number | null;
    createdAt: string | Date;
    validUntil: string | Date | null;
  }>;
  cases: Array<{
    id: string;
    title: string;
    status: string;
    caseType: string;
    createdAt: string | Date;
  }>;
  properties: Array<{
    id: string;
    name: string;
    address: string;
    suburb: string;
    bedrooms: number;
    bathrooms: number;
    integration?: { isEnabled: boolean; icalUrl: string | null; syncStatus?: string | null } | null;
  }>;
  jobs: Array<{
    id: string;
    jobNumber: string | null;
    jobType: string;
    status: string;
    scheduledDate: string | Date;
    property?: { id: string; name: string; suburb: string | null } | null;
  }>;
};

function prettify(value?: string | null) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

function formatEstimate(min: number | null, max: number | null) {
  if (min == null && max == null) return "-";
  if (min != null && max != null) return `$${min.toFixed(2)} - $${max.toFixed(2)}`;
  return `$${Number(max ?? min ?? 0).toFixed(2)}`;
}

type NotifPref = {
  notificationsEnabled: boolean;
  notifyOnEnRoute: boolean;
  notifyOnJobStart: boolean;
  notifyOnJobComplete: boolean;
  preferredChannel: "EMAIL" | "SMS" | "BOTH";
};

const DEFAULT_NOTIF_PREF: NotifPref = {
  notificationsEnabled: true,
  notifyOnEnRoute: true,
  notifyOnJobStart: true,
  notifyOnJobComplete: true,
  preferredChannel: "EMAIL",
};

export function ClientDetailWorkspace({ client }: { client: ClientDetail }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: client.name,
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    notes: client.notes ?? "",
  });

  const [notifPref, setNotifPref] = useState<NotifPref>(DEFAULT_NOTIF_PREF);
  const [savingNotif, setSavingNotif] = useState(false);

  const [automationRules, setAutomationRules] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [addingRule, setAddingRule] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    triggerType: "POST_JOB_REVIEW" as string,
    jobType: "",
    templateId: "",
    delayMinutes: "120",
    channel: "EMAIL" as string,
  });

  useEffect(() => {
    fetch(`/api/admin/clients/${client.id}/notification-preferences`)
      .then((res) => res.json())
      .then((data) => { if (data && !data.error) setNotifPref(data); })
      .catch(() => {});

    fetch(`/api/admin/clients/${client.id}/automation-rules`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setAutomationRules(data); })
      .catch(() => {});

    fetch("/api/admin/message-templates")
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setTemplates(data); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  async function saveNotifPref() {
    setSavingNotif(true);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}/notification-preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notifPref),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Failed to save", description: body.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      toast({ title: "Notification preferences saved" });
    } finally {
      setSavingNotif(false);
    }
  }

  async function saveClient() {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update client.");
      toast({ title: "Client updated" });
      setEditing(false);
    } catch (error: any) {
      toast({ title: "Update failed", description: error?.message ?? "Could not update client.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">{form.name}</h2>
                <p className="text-sm text-muted-foreground">
                  Client since {format(new Date(client.createdAt), "MMMM yyyy")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {editing ? (
                  <>
                    <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button onClick={saveClient} disabled={saving}>
                      {saving ? "Saving..." : "Save"}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    Edit details
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.name} disabled={!editing} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={form.email} disabled={!editing} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} disabled={!editing} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input value={form.address} disabled={!editing} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={form.notes} disabled={!editing} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Properties</p>
                <p className="text-2xl font-semibold">{client.properties.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Quotes</p>
                <p className="text-2xl font-semibold">{client.quotes.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Jobs</p>
                <p className="text-2xl font-semibold">{client.jobs.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Cases</p>
                <p className="text-2xl font-semibold">{client.cases.length}</p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="leads" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start gap-2 bg-transparent p-0">
          <TabsTrigger value="leads">Linked Leads</TabsTrigger>
          <TabsTrigger value="quotes">Quotes</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="cases">Cases</TabsTrigger>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="leads">
          <Card>
            <CardContent className="space-y-3 p-4">
              {client.leads.length === 0 ? <p className="text-sm text-muted-foreground">No linked leads.</p> : client.leads.map((lead) => (
                <div key={lead.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{prettify(lead.serviceType) || "Lead"}</p>
                    <Badge variant="outline">{prettify(lead.status)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Estimate {formatEstimate(lead.estimateMin, lead.estimateMax)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Created {format(new Date(lead.createdAt), "dd MMM yyyy")}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quotes">
          <Card>
            <CardContent className="space-y-3 p-4">
              {client.quotes.length === 0 ? <p className="text-sm text-muted-foreground">No quotes yet.</p> : client.quotes.map((quote) => (
                <div key={quote.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <div>
                    <p className="font-medium">{quote.totalAmount != null ? `$${Number(quote.totalAmount).toFixed(2)}` : "Quote"}</p>
                    <p className="text-sm text-muted-foreground">Created {format(new Date(quote.createdAt), "dd MMM yyyy")}</p>
                    {quote.validUntil ? <p className="text-xs text-muted-foreground">Valid until {format(new Date(quote.validUntil), "dd MMM yyyy")}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{prettify(quote.status)}</Badge>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/api/admin/quotes/${quote.id}/pdf`} target="_blank">
                        PDF
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs">
          <Card>
            <CardContent className="space-y-3 p-4">
              {client.jobs.length === 0 ? <p className="text-sm text-muted-foreground">No jobs for this client yet.</p> : client.jobs.map((job) => (
                <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <div>
                    <p className="font-medium">
                      {job.property?.name || "Property"} {job.jobNumber ? <span className="text-xs text-muted-foreground">· {job.jobNumber}</span> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {prettify(job.jobType)} · {format(new Date(job.scheduledDate), "dd MMM yyyy")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{prettify(job.status)}</Badge>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/jobs/${job.id}`}>Open job</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cases">
          <Card>
            <CardContent className="space-y-3 p-4">
              {client.cases.length === 0 ? <p className="text-sm text-muted-foreground">No linked cases.</p> : client.cases.map((caseItem) => (
                <div key={caseItem.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <div>
                    <p className="font-medium">{caseItem.title}</p>
                    <p className="text-sm text-muted-foreground">{prettify(caseItem.caseType)} · {format(new Date(caseItem.createdAt), "dd MMM yyyy")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{prettify(caseItem.status)}</Badge>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/cases?caseId=${caseItem.id}`}>Open case</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="properties">
          <Card>
            <CardContent className="space-y-3 p-4">
              {client.properties.length === 0 ? <p className="text-sm text-muted-foreground">No properties yet.</p> : client.properties.map((property) => (
                <div key={property.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <div>
                    <p className="font-medium">{property.name}</p>
                    <p className="text-sm text-muted-foreground">{property.address}, {property.suburb}</p>
                    <p className="text-xs text-muted-foreground">{property.bedrooms} bed · {property.bathrooms} bath</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {property.integration?.isEnabled ? <Badge variant="success">iCal enabled</Badge> : <Badge variant="secondary">No iCal</Badge>}
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/properties/${property.id}`}>Open property</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Client Notification Settings</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control when and how this client receives automated job status notifications.
                </p>
              </div>
              <Button size="sm" onClick={saveNotifPref} disabled={savingNotif}>
                {savingNotif ? "Saving..." : "Save"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              <label className="flex items-center justify-between gap-3 rounded-md border p-4">
                <div>
                  <p className="text-sm font-medium">Notifications enabled</p>
                  <p className="text-xs text-muted-foreground">Master toggle — disabling this suppresses all automated messages to this client.</p>
                </div>
                <Switch
                  checked={notifPref.notificationsEnabled}
                  onCheckedChange={(value) => setNotifPref((prev) => ({ ...prev, notificationsEnabled: value }))}
                />
              </label>

              <div className={notifPref.notificationsEnabled ? "" : "pointer-events-none opacity-50"}>
                <p className="mb-3 text-xs font-medium uppercase text-muted-foreground">Events</p>
                <div className="space-y-2">
                  <label className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm">Cleaner on the way</p>
                      <p className="text-xs text-muted-foreground">Sent when cleaner starts driving to the property</p>
                    </div>
                    <Switch
                      checked={notifPref.notifyOnEnRoute}
                      onCheckedChange={(value) => setNotifPref((prev) => ({ ...prev, notifyOnEnRoute: value }))}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm">Cleaning started</p>
                      <p className="text-xs text-muted-foreground">Sent when cleaner checks in and starts the job</p>
                    </div>
                    <Switch
                      checked={notifPref.notifyOnJobStart}
                      onCheckedChange={(value) => setNotifPref((prev) => ({ ...prev, notifyOnJobStart: value }))}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm">Cleaning complete</p>
                      <p className="text-xs text-muted-foreground">Sent when cleaner submits the job</p>
                    </div>
                    <Switch
                      checked={notifPref.notifyOnJobComplete}
                      onCheckedChange={(value) => setNotifPref((prev) => ({ ...prev, notifyOnJobComplete: value }))}
                    />
                  </label>
                </div>

                <p className="mb-3 mt-5 text-xs font-medium uppercase text-muted-foreground">Delivery channel</p>
                <div className="flex flex-wrap gap-2">
                  {(["EMAIL", "SMS", "BOTH"] as const).map((channel) => (
                    <button
                      key={channel}
                      type="button"
                      onClick={() => setNotifPref((prev) => ({ ...prev, preferredChannel: channel }))}
                      className={`rounded-md border px-4 py-2 text-sm transition-colors ${
                        notifPref.preferredChannel === channel
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      {channel === "EMAIL" ? "Email only" : channel === "SMS" ? "SMS only" : "Email + SMS"}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
