"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PencilLine, RefreshCcw, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { toast } from "@/hooks/use-toast";

type NotificationCategory =
  | "account"
  | "jobs"
  | "laundry"
  | "cases"
  | "reports"
  | "quotes"
  | "shopping"
  | "billing"
  | "approvals";

type NotificationChannelPreference = {
  web: boolean;
  email: boolean;
  sms: boolean;
};

type NotificationDefaultsSettings = {
  categories: Record<NotificationCategory, NotificationChannelPreference>;
};

type ScheduledNotificationSettings = {
  reminder24hEnabled: boolean;
  reminder2hEnabled: boolean;
  tomorrowPrepEnabled: boolean;
  tomorrowPrepTime: string;
  stockAlertsEnabled: boolean;
  stockAlertsTime: string;
  adminAttentionSummaryEnabled: boolean;
  adminAttentionSummaryTime: string;
  autoApproveLaundrySyncDrafts: boolean;
  laundrySyncNotificationHorizonDays: number;
};

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "account",
  "jobs",
  "laundry",
  "cases",
  "reports",
  "quotes",
  "shopping",
  "billing",
  "approvals",
];

type StaffUser = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: "ADMIN" | "OPS_MANAGER" | "CLEANER" | "LAUNDRY" | "CLIENT";
  notificationPreference?: { updatedAt: string } | null;
};

type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  _count?: { properties: number };
};

type ClientPreference = {
  notificationsEnabled: boolean;
  notifyOnEnRoute: boolean;
  notifyOnJobStart: boolean;
  notifyOnJobComplete: boolean;
  preferredChannel: "EMAIL" | "SMS" | "BOTH";
};

type LogItem = {
  id: string;
  href?: string | null;
  subject?: string | null;
  body: string;
  createdAt: string;
  channel: string;
  status: string;
  user?: { email?: string | null } | null;
};

const EMPTY_CLIENT_PREF: ClientPreference = {
  notificationsEnabled: true,
  notifyOnEnRoute: true,
  notifyOnJobStart: true,
  notifyOnJobComplete: true,
  preferredChannel: "EMAIL",
};

function emptyUserPrefs() {
  return Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [category, { web: false, email: false, sms: false }])
  ) as Record<NotificationCategory, NotificationChannelPreference>;
}

function categoryLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function updateMatrix<T extends Record<string, NotificationChannelPreference>>(
  current: T,
  key: keyof T,
  channel: keyof NotificationChannelPreference,
  value: boolean
) {
  return { ...current, [key]: { ...current[key], [channel]: value } };
}

export default function NotificationsPage() {
  const [tab, setTab] = useState("control");
  const [loadingControl, setLoadingControl] = useState(true);
  const [savingControl, setSavingControl] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledNotificationSettings | null>(null);
  const [defaults, setDefaults] = useState<NotificationDefaultsSettings | null>(null);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);

  const [userEditor, setUserEditor] = useState<StaffUser | null>(null);
  const [userPrefs, setUserPrefs] = useState<Record<NotificationCategory, NotificationChannelPreference>>(emptyUserPrefs());
  const [savingUser, setSavingUser] = useState(false);

  const [clientEditor, setClientEditor] = useState<ClientRow | null>(null);
  const [clientPrefs, setClientPrefs] = useState<ClientPreference>(EMPTY_CLIENT_PREF);
  const [savingClient, setSavingClient] = useState(false);

  const [items, setItems] = useState<LogItem[]>([]);
  const [filters, setFilters] = useState({ q: "", channel: "all", status: "all", source: "all" });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, totalCount: 0, totalPages: 1, hasMore: false });
  const [loadingLog, setLoadingLog] = useState(true);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function loadControl() {
    setLoadingControl(true);
    const [settingsRes, usersRes, clientsRes] = await Promise.all([
      fetch("/api/admin/settings", { cache: "no-store" }),
      fetch("/api/admin/users", { cache: "no-store" }),
      fetch("/api/admin/clients", { cache: "no-store" }),
    ]);
    const [settingsBody, usersBody, clientsBody] = await Promise.all([
      settingsRes.json().catch(() => null),
      usersRes.json().catch(() => []),
      clientsRes.json().catch(() => []),
    ]);
    if (settingsRes.ok && settingsBody?.scheduledNotifications && settingsBody?.notificationDefaults) {
      setScheduled(settingsBody.scheduledNotifications);
      setDefaults(settingsBody.notificationDefaults);
    }
    setUsers(Array.isArray(usersBody) ? usersBody : []);
    setClients(Array.isArray(clientsBody) ? clientsBody : []);
    setLoadingControl(false);
  }

  async function loadLog() {
    setLoadingLog(true);
    const params = new URLSearchParams({ page: String(page), limit: "50", ...filters });
    if (!filters.q.trim()) params.delete("q");
    const res = await fetch(`/api/admin/notifications/log?${params.toString()}`);
    const body = await res.json().catch(() => ({}));
    setItems(Array.isArray(body?.items) ? body.items : []);
    setPagination(body?.pagination ?? { page: 1, limit: 50, totalCount: 0, totalPages: 1, hasMore: false });
    setLoadingLog(false);
  }

  useEffect(() => { loadControl(); }, []);
  useEffect(() => { loadLog(); }, [page, filters.channel, filters.status, filters.source, filters.q]);
  useEffect(() => { setPage(1); }, [filters.channel, filters.status, filters.source, filters.q]);

  const adminUsers = useMemo(() => users.filter((u) => u.role === "ADMIN" || u.role === "OPS_MANAGER"), [users]);
  const cleanerUsers = useMemo(() => users.filter((u) => u.role === "CLEANER"), [users]);
  const laundryUsers = useMemo(() => users.filter((u) => u.role === "LAUNDRY"), [users]);

  async function saveControlCenter() {
    if (!scheduled || !defaults) return;
    setSavingControl(true);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledNotifications: scheduled, notificationDefaults: defaults }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingControl(false);
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Could not save notification settings.", variant: "destructive" });
      return;
    }
    toast({ title: "Notification settings updated" });
  }

  async function openUser(user: StaffUser) {
    setUserEditor(user);
    const res = await fetch(`/api/admin/users/${user.id}/notification-preferences`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Load failed", description: body.error ?? "Could not load user preferences.", variant: "destructive" });
      setUserEditor(null);
      return;
    }
    setUserPrefs(body);
  }

  async function saveUserPrefs() {
    if (!userEditor) return;
    setSavingUser(true);
    const res = await fetch(`/api/admin/users/${userEditor.id}/notification-preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userPrefs),
    });
    const body = await res.json().catch(() => ({}));
    setSavingUser(false);
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Could not save user override.", variant: "destructive" });
      return;
    }
    setUsers((rows) => rows.map((row) => row.id === userEditor.id ? { ...row, notificationPreference: { updatedAt: new Date().toISOString() } } : row));
    toast({ title: "User override saved" });
    setUserEditor(null);
  }

  async function openClient(client: ClientRow) {
    setClientEditor(client);
    const res = await fetch(`/api/admin/clients/${client.id}/notification-preferences`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Load failed", description: body.error ?? "Could not load client preferences.", variant: "destructive" });
      setClientEditor(null);
      return;
    }
    setClientPrefs({
      notificationsEnabled: Boolean(body.notificationsEnabled),
      notifyOnEnRoute: Boolean(body.notifyOnEnRoute),
      notifyOnJobStart: Boolean(body.notifyOnJobStart),
      notifyOnJobComplete: Boolean(body.notifyOnJobComplete),
      preferredChannel: body.preferredChannel ?? "EMAIL",
    });
  }

  async function saveClientPrefs() {
    if (!clientEditor) return;
    setSavingClient(true);
    const res = await fetch(`/api/admin/clients/${clientEditor.id}/notification-preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clientPrefs),
    });
    const body = await res.json().catch(() => ({}));
    setSavingClient(false);
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Could not save client preferences.", variant: "destructive" });
      return;
    }
    toast({ title: "Client override saved" });
    setClientEditor(null);
  }

  async function clearAll() {
    setClearing(true);
    const res = await fetch("/api/admin/notifications/log", { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setClearing(false);
    if (!res.ok) {
      toast({ title: "Clear failed", description: body.error ?? "Could not clear notification log.", variant: "destructive" });
      return;
    }
    toast({ title: "Notification log cleared" });
    setClearOpen(false);
    loadLog();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold">Notifications</h2>
          <p className="text-sm text-muted-foreground">Defaults, timed automation, profile overrides, and delivery history.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { loadControl(); loadLog(); }}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="destructive" onClick={() => setClearOpen(true)} disabled={items.length === 0}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear logs
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="control">Control center</TabsTrigger>
          <TabsTrigger value="log">Delivery log</TabsTrigger>
        </TabsList>

        <TabsContent value="control" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>Global controls</CardTitle>
                <CardDescription>Timed notification jobs, default delivery channels, and laundry sync horizon.</CardDescription>
              </div>
              <Button onClick={saveControlCenter} disabled={loadingControl || savingControl || !scheduled || !defaults}>
                {savingControl ? "Saving..." : "Save controls"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {loadingControl || !scheduled || !defaults ? (
                <p className="text-sm text-muted-foreground">Loading notification control center...</p>
              ) : (
                <>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {[
                      ["24-hour reminders", "reminder24hEnabled"],
                      ["2-hour reminders", "reminder2hEnabled"],
                      ["Tomorrow prep dispatch", "tomorrowPrepEnabled"],
                      ["Critical stock alerts", "stockAlertsEnabled"],
                      ["Admin attention summary", "adminAttentionSummaryEnabled"],
                      ["Auto-approve laundry drafts", "autoApproveLaundrySyncDrafts"],
                    ].map(([label, key]) => (
                      <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                        <Label className="text-sm">{label}</Label>
                        <Switch checked={Boolean((scheduled as any)[key])} onCheckedChange={(value) => setScheduled((prev) => prev ? { ...prev, [key]: value } : prev)} />
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-1.5"><Label>Tomorrow prep time</Label><Input type="time" value={scheduled.tomorrowPrepTime} onChange={(e) => setScheduled((prev) => prev ? { ...prev, tomorrowPrepTime: e.target.value || prev.tomorrowPrepTime } : prev)} /></div>
                    <div className="space-y-1.5"><Label>Stock alert time</Label><Input type="time" value={scheduled.stockAlertsTime} onChange={(e) => setScheduled((prev) => prev ? { ...prev, stockAlertsTime: e.target.value || prev.stockAlertsTime } : prev)} /></div>
                    <div className="space-y-1.5"><Label>Admin summary time</Label><Input type="time" value={scheduled.adminAttentionSummaryTime} onChange={(e) => setScheduled((prev) => prev ? { ...prev, adminAttentionSummaryTime: e.target.value || prev.adminAttentionSummaryTime } : prev)} /></div>
                    <div className="space-y-1.5"><Label>Laundry horizon (days)</Label><Input type="number" min={1} max={120} value={scheduled.laundrySyncNotificationHorizonDays} onChange={(e) => setScheduled((prev) => prev ? { ...prev, laundrySyncNotificationHorizonDays: Number(e.target.value || prev.laundrySyncNotificationHorizonDays) } : prev)} /></div>
                  </div>
                  <div className="grid gap-3">
                    {NOTIFICATION_CATEGORIES.map((category) => (
                      <div key={category} className="grid items-center gap-3 rounded-lg border p-3 md:grid-cols-[180px_repeat(3,minmax(0,1fr))]">
                        <div><p className="text-sm font-medium">{categoryLabel(category)}</p><p className="text-xs text-muted-foreground">Default channels</p></div>
                        {(["web", "email", "sms"] as const).map((channel) => (
                          <div key={`${category}-${channel}`} className="flex items-center justify-between rounded border p-2">
                            <Label className="text-xs uppercase">{channel}</Label>
                            <Switch checked={Boolean(defaults.categories[category][channel])} onCheckedChange={(value) => setDefaults((prev) => prev ? { ...prev, categories: updateMatrix(prev.categories, category, channel, value) } : prev)} />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profile overrides</CardTitle>
              <CardDescription>Staff overrides update the same per-user preference records shown inside profile settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="admins" className="space-y-4">
                <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
                  <TabsTrigger value="admins">Admin / Ops</TabsTrigger>
                  <TabsTrigger value="cleaners">Cleaners</TabsTrigger>
                  <TabsTrigger value="laundry">Laundry</TabsTrigger>
                  <TabsTrigger value="clients">Clients</TabsTrigger>
                </TabsList>
                <TabsContent value="admins"><UserList rows={adminUsers} onEdit={openUser} emptyText="No admin or ops users found." /></TabsContent>
                <TabsContent value="cleaners"><UserList rows={cleanerUsers} onEdit={openUser} emptyText="No cleaners found." /></TabsContent>
                <TabsContent value="laundry"><UserList rows={laundryUsers} onEdit={openUser} emptyText="No laundry users found." /></TabsContent>
                <TabsContent value="clients">
                  <ScrollArea className="max-h-[520px] pr-4">
                    <div className="space-y-3">
                      {clients.length === 0 ? <p className="rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">No clients found.</p> : clients.map((client) => (
                        <div key={client.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{client.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{client.email || "No email"}{client.phone ? ` • ${client.phone}` : ""}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">{client._count?.properties ?? 0} properties linked</p>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => openClient(client)}>
                            <PencilLine className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="log" className="space-y-6">
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-[1.6fr_160px_160px_160px_auto]">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Search</p>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" value={filters.q} onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))} placeholder="Subject, body, user, or email" />
                </div>
              </div>
              <div className="space-y-1.5"><p className="text-xs font-medium text-muted-foreground">Source</p><Select value={filters.source} onValueChange={(value) => setFilters((prev) => ({ ...prev, source: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All sources</SelectItem><SelectItem value="notification">Notifications</SelectItem><SelectItem value="audit">Audit only</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><p className="text-xs font-medium text-muted-foreground">Channel</p><Select value={filters.channel} onValueChange={(value) => setFilters((prev) => ({ ...prev, channel: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem><SelectItem value="EMAIL">Email</SelectItem><SelectItem value="SMS">SMS</SelectItem><SelectItem value="PUSH">Push</SelectItem><SelectItem value="AUDIT">Audit</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><p className="text-xs font-medium text-muted-foreground">Status</p><Select value={filters.status} onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="SENT">Sent</SelectItem><SelectItem value="PENDING">Pending</SelectItem><SelectItem value="FAILED">Failed</SelectItem></SelectContent></Select></div>
              <div className="flex items-end"><Button variant="ghost" onClick={() => setFilters({ q: "", channel: "all", status: "all", source: "all" })}>Clear</Button></div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {loadingLog ? <p className="py-10 text-center text-sm text-muted-foreground">Loading notifications...</p> : items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No notifications found.</p> : (
                <div className="divide-y">
                  {items.map((item) => (
                    <Link key={item.id} href={item.href ?? "/admin/notifications"} className="block px-5 py-3 transition-colors hover:bg-muted/40">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">{item.subject ?? "Notification"}</p>
                          <p className="text-xs text-muted-foreground">{item.body}</p>
                          <p className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleString("en-AU")}{item.user?.email ? ` | ${item.user.email}` : ""}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{item.channel}</Badge>
                          <Badge variant={item.status === "FAILED" ? "destructive" : item.status === "SENT" ? "success" : "secondary"}>{item.status}</Badge>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
            <p className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages} • {pagination.totalCount} matching items</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
              <Button variant="outline" size="sm" disabled={!pagination.hasMore} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(userEditor)} onOpenChange={(open) => !open && setUserEditor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{userEditor ? `Edit notifications: ${userEditor.name || userEditor.email}` : "Edit notifications"}</DialogTitle></DialogHeader>
          {userEditor ? (
            <div className="space-y-4">
              <ScrollArea className="max-h-[60vh] pr-4">
                <div className="space-y-3">
                  {NOTIFICATION_CATEGORIES.map((category) => (
                    <div key={category} className="grid items-center gap-3 rounded-lg border p-3 md:grid-cols-[180px_repeat(3,minmax(0,1fr))]">
                      <div><p className="text-sm font-medium">{categoryLabel(category)}</p><p className="text-xs text-muted-foreground">Per-profile override</p></div>
                      {(["web", "email", "sms"] as const).map((channel) => (
                        <div key={`${category}-${channel}`} className="flex items-center justify-between rounded border p-2">
                          <Label className="text-xs uppercase">{channel}</Label>
                          <Switch checked={Boolean(userPrefs[category]?.[channel])} onCheckedChange={(value) => setUserPrefs((prev) => updateMatrix(prev, category, channel, value))} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setUserEditor(null)} disabled={savingUser}>Cancel</Button><Button onClick={saveUserPrefs} disabled={savingUser}>{savingUser ? "Saving..." : "Save override"}</Button></div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(clientEditor)} onOpenChange={(open) => !open && setClientEditor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{clientEditor ? `Client job updates: ${clientEditor.name}` : "Client updates"}</DialogTitle></DialogHeader>
          {clientEditor ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3"><Label>Notifications enabled</Label><Switch checked={clientPrefs.notificationsEnabled} onCheckedChange={(value) => setClientPrefs((prev) => ({ ...prev, notificationsEnabled: value }))} /></div>
              <div className="flex items-center justify-between rounded-lg border p-3"><Label>Notify when cleaner is en route</Label><Switch checked={clientPrefs.notifyOnEnRoute} onCheckedChange={(value) => setClientPrefs((prev) => ({ ...prev, notifyOnEnRoute: value }))} /></div>
              <div className="flex items-center justify-between rounded-lg border p-3"><Label>Notify when job starts</Label><Switch checked={clientPrefs.notifyOnJobStart} onCheckedChange={(value) => setClientPrefs((prev) => ({ ...prev, notifyOnJobStart: value }))} /></div>
              <div className="flex items-center justify-between rounded-lg border p-3"><Label>Notify when job completes</Label><Switch checked={clientPrefs.notifyOnJobComplete} onCheckedChange={(value) => setClientPrefs((prev) => ({ ...prev, notifyOnJobComplete: value }))} /></div>
              <div className="space-y-1.5"><Label>Preferred channel</Label><Select value={clientPrefs.preferredChannel} onValueChange={(value: "EMAIL" | "SMS" | "BOTH") => setClientPrefs((prev) => ({ ...prev, preferredChannel: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EMAIL">Email only</SelectItem><SelectItem value="SMS">SMS only</SelectItem><SelectItem value="BOTH">Email and SMS</SelectItem></SelectContent></Select></div>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setClientEditor(null)} disabled={savingClient}>Cancel</Button><Button onClick={saveClientPrefs} disabled={savingClient}>{savingClient ? "Saving..." : "Save client override"}</Button></div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog open={clearOpen} onOpenChange={setClearOpen} title="Clear notifications" description="This will remove all notification logs from the system." actionKey="clearNotificationLog" confirmLabel="Yes" cancelLabel="No" loading={clearing} onConfirm={clearAll} />
    </div>
  );
}

function UserList({ rows, onEdit, emptyText }: { rows: StaffUser[]; onEdit: (user: StaffUser) => void; emptyText: string }) {
  return (
    <ScrollArea className="max-h-[520px] pr-4">
      <div className="space-y-3">
        {rows.length === 0 ? <p className="rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">{emptyText}</p> : rows.map((user) => (
          <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.name || user.email}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}{user.phone ? ` • ${user.phone}` : ""}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">{user.role === "OPS_MANAGER" ? "Ops Manager" : user.role}</Badge>
                {user.notificationPreference?.updatedAt ? <Badge variant="secondary">Override active</Badge> : <Badge variant="outline">Using defaults</Badge>}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => onEdit(user)}>
              <PencilLine className="mr-2 h-4 w-4" />
              Edit
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
