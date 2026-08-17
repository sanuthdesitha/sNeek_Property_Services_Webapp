"use client";

import { useEffect, useMemo, useState } from "react";
import { PencilLine } from "lucide-react";
import { EMAIL_AUTO_KINDS } from "@/lib/notifications/email-kinds";
import { NOTIFICATION_AUDIENCES } from "@/lib/notifications/audience-controls";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { UserEmailPreferencesModal } from "@/components/v2/admin/comms/user-email-preferences";
import type { EstateToast } from "@/components/v2/admin/comms/toast";

type NotificationCategory =
  | "account" | "jobs" | "laundry" | "cases" | "reports"
  | "quotes" | "shopping" | "billing" | "approvals" | "ical";

type ChannelPref = { web: boolean; email: boolean; sms: boolean };
type Defaults = { categories: Record<NotificationCategory, ChannelPref> };
type Scheduled = {
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
type EmailAutomation = {
  masterEnabled: boolean;
  types: Record<string, boolean>;
  /** audience -> kind -> allowed. Only `false` is ever stored; a missing entry means allowed. */
  audienceKinds?: Record<string, Record<string, boolean>>;
};

type StaffUser = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: "ADMIN" | "OPS_MANAGER" | "CLEANER" | "LAUNDRY" | "CLIENT";
  notificationPreference?: { updatedAt: string } | null;
};
type ClientRow = { id: string; name: string; email: string | null; phone: string | null; _count?: { properties: number } };
type ClientPref = {
  notificationsEnabled: boolean;
  notifyOnEnRoute: boolean;
  notifyOnJobStart: boolean;
  notifyOnJobComplete: boolean;
  preferredChannel: "EMAIL" | "SMS" | "BOTH";
};

const CATEGORIES: NotificationCategory[] = [
  "account", "jobs", "laundry", "cases", "reports", "quotes", "shopping", "billing", "approvals", "ical",
];
const CATEGORY_META: Record<NotificationCategory, { label: string; description: string }> = {
  account: { label: "Account & access", description: "New profiles, invitations, password/2FA and login changes." },
  jobs: { label: "Jobs & scheduling", description: "Job offers, assignments, reminders, reschedules and completions." },
  laundry: { label: "Laundry", description: "Laundry ready for pickup, skips and status updates." },
  cases: { label: "Cases & issues", description: "Damage reports, complaints and case updates." },
  reports: { label: "Reports", description: "Job reports generated and shared." },
  quotes: { label: "Quotes & leads", description: "New quotes, lead activity and quote responses." },
  shopping: { label: "Inventory & shopping", description: "Stock alerts, shopping runs and restock approvals." },
  billing: { label: "Billing & payroll", description: "Invoices, payouts and pay adjustments." },
  approvals: { label: "Approvals", description: "Items waiting on approval (tasks, pay, time, rework)." },
  ical: { label: "iCal / calendar sync", description: "Automatic iCal sync alerts when bookings create or change jobs." },
};

const EMPTY_CLIENT_PREF: ClientPref = {
  notificationsEnabled: true,
  notifyOnEnRoute: true,
  notifyOnJobStart: true,
  notifyOnJobComplete: true,
  preferredChannel: "EMAIL",
};

function emptyUserPrefs() {
  return Object.fromEntries(CATEGORIES.map((c) => [c, { web: false, email: false, sms: false }])) as Record<NotificationCategory, ChannelPref>;
}
function updateMatrix<T extends Record<string, ChannelPref>>(current: T, key: keyof T, channel: keyof ChannelPref, value: boolean) {
  return { ...current, [key]: { ...current[key], [channel]: value } };
}

const SCHEDULED_TOGGLES: Array<[string, keyof Scheduled]> = [
  ["24-hour reminders", "reminder24hEnabled"],
  ["2-hour reminders", "reminder2hEnabled"],
  ["Tomorrow prep dispatch", "tomorrowPrepEnabled"],
  ["Critical stock alerts", "stockAlertsEnabled"],
  ["Admin attention summary", "adminAttentionSummaryEnabled"],
  ["Auto-approve laundry drafts", "autoApproveLaundrySyncDrafts"],
];

export function CommsControlCenter({ onToast }: { onToast: (t: EstateToast) => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scheduled, setScheduled] = useState<Scheduled | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [emailAutomation, setEmailAutomation] = useState<EmailAutomation | null>(null);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [profileTab, setProfileTab] = useState<"admins" | "cleaners" | "laundry" | "clients">("admins");

  const [userEditor, setUserEditor] = useState<StaffUser | null>(null);
  const [userPrefs, setUserPrefs] = useState<Record<NotificationCategory, ChannelPref>>(emptyUserPrefs());
  const [savingUser, setSavingUser] = useState(false);
  // Per-person email overrides. `disabledKinds` holds only the deviations, so
  // an absent entry means the person follows the global setting.
  /** The person whose full email grid is open, or null. */
  const [editingUser, setEditingUser] = useState<{ id: string; label: string } | null>(null);
  const [emailPrefs, setEmailPrefs] = useState<{
    disabledKinds: Record<string, string[]>;
    allEmailOff: string[];
  }>({ disabledKinds: {}, allEmailOff: [] });
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [bulkKind, setBulkKind] = useState<string>(EMAIL_AUTO_KINDS[0]?.key ?? "");
  const [savingPeople, setSavingPeople] = useState(false);

  const [clientEditor, setClientEditor] = useState<ClientRow | null>(null);
  const [clientPrefs, setClientPrefs] = useState<ClientPref>(EMPTY_CLIENT_PREF);
  const [savingClient, setSavingClient] = useState(false);

  async function loadControl() {
    setLoading(true);
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
    if (settingsRes.ok && settingsBody?.emailAutomation) setEmailAutomation(settingsBody.emailAutomation);
    setUsers(Array.isArray(usersBody) ? usersBody : []);
    setClients(Array.isArray(clientsBody) ? clientsBody : []);
    // Separate fetch: a failure here must leave the rest of the screen usable
    // rather than blanking the whole control center.
    try {
      const prefRes = await fetch("/api/admin/users/email-preferences/bulk", { cache: "no-store" });
      if (prefRes.ok) {
        const prefBody = await prefRes.json();
        setEmailPrefs({
          disabledKinds: prefBody?.disabledKinds ?? {},
          allEmailOff: Array.isArray(prefBody?.allEmailOff) ? prefBody.allEmailOff : [],
        });
      }
    } catch {
      /* leave the overrides section empty rather than breaking the page */
    }
    setLoading(false);
  }

  useEffect(() => { loadControl(); }, []);

  const adminUsers = useMemo(() => users.filter((u) => u.role === "ADMIN" || u.role === "OPS_MANAGER"), [users]);
  const cleanerUsers = useMemo(() => users.filter((u) => u.role === "CLEANER"), [users]);
  const laundryUsers = useMemo(() => users.filter((u) => u.role === "LAUNDRY"), [users]);

  /**
   * Tick / untick one audience+kind cell.
   *
   * Only `false` is stored. Writing `true` would bake today's default into the
   * saved settings, so a kind added later would arrive already-decided for
   * every group instead of simply being allowed.
   */
  function setAudienceKind(audience: string, kind: string, allowed: boolean) {
    setEmailAutomation((prev) => {
      if (!prev) return prev;
      const next = { ...(prev.audienceKinds ?? {}) };
      const bucket = { ...(next[audience] ?? {}) };
      if (allowed) delete bucket[kind];
      else bucket[kind] = false;
      if (Object.keys(bucket).length === 0) delete next[audience];
      else next[audience] = bucket;
      return { ...prev, audienceKinds: next };
    });
  }

  /**
   * Apply an email choice to everyone currently selected.
   *
   * Only the named kind (or the all-off flag) is sent — the route leaves every
   * other preference untouched, so using this on one type cannot silently
   * reset choices someone made about the others.
   */
  async function applyToSelected(patch: { allEmailOff?: boolean; kinds?: Record<string, boolean> }) {
    if (selectedPeople.length === 0) return;
    setSavingPeople(true);
    try {
      const res = await fetch("/api/admin/users/email-preferences/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: selectedPeople, ...patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast({ title: "Save failed", description: body.error ?? "Could not update email preferences.", tone: "danger" });
        return;
      }
      onToast({ title: `Updated ${body.affected ?? selectedPeople.length} ${(body.affected ?? 1) === 1 ? "person" : "people"}`, tone: "success" });
      await loadControl();
    } finally {
      setSavingPeople(false);
    }
  }

  async function saveControlCenter() {
    if (!scheduled || !defaults) return;
    setSaving(true);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledNotifications: scheduled,
        notificationDefaults: defaults,
        ...(emailAutomation ? { emailAutomation } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return onToast({ title: "Save failed", description: body.error ?? "Could not save notification settings.", tone: "danger" });
    onToast({ title: "Notification settings updated", tone: "success" });
  }

  async function openUser(user: StaffUser) {
    setUserEditor(user);
    const res = await fetch(`/api/admin/users/${user.id}/notification-preferences`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      onToast({ title: "Load failed", description: body.error ?? "Could not load user preferences.", tone: "danger" });
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
    if (!res.ok) return onToast({ title: "Save failed", description: body.error ?? "Could not save user override.", tone: "danger" });
    setUsers((rows) => rows.map((r) => (r.id === userEditor.id ? { ...r, notificationPreference: { updatedAt: new Date().toISOString() } } : r)));
    onToast({ title: "User override saved", tone: "success" });
    setUserEditor(null);
  }

  async function openClient(client: ClientRow) {
    setClientEditor(client);
    const res = await fetch(`/api/admin/clients/${client.id}/notification-preferences`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      onToast({ title: "Load failed", description: body.error ?? "Could not load client preferences.", tone: "danger" });
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
    if (!res.ok) return onToast({ title: "Save failed", description: body.error ?? "Could not save client preferences.", tone: "danger" });
    onToast({ title: "Client override saved", tone: "success" });
    setClientEditor(null);
  }

  const profileBtn = (key: typeof profileTab, label: string) => (
    <button
      type="button"
      onClick={() => setProfileTab(key)}
      className={`rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors ${
        profileTab === key ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
      }`}
    >
      {label}
    </button>
  );

  const profileRows = profileTab === "admins" ? adminUsers : profileTab === "cleaners" ? cleanerUsers : profileTab === "laundry" ? laundryUsers : [];

  return (
    <div className="space-y-6">
      {/* Global controls */}
      <ECard>
        <ECardHeader className="flex-row items-start justify-between gap-3 pb-3">
          <div>
            <ECardTitle className="text-[0.95rem]">Global controls</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Timed notification jobs, default delivery channels, and laundry sync horizon.</p>
          </div>
          <EButton size="sm" onClick={saveControlCenter} disabled={loading || saving || !scheduled || !defaults}>{saving ? "Saving…" : "Save controls"}</EButton>
        </ECardHeader>
        <ECardBody className="space-y-6 pt-0">
          {loading || !scheduled || !defaults ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading notification control center…</p>
          ) : (
            <>
              <div className="grid gap-3 xl:grid-cols-2">
                {SCHEDULED_TOGGLES.map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                    <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">{label}</span>
                    <ESwitch checked={Boolean((scheduled as any)[key])} onCheckedChange={(v) => setScheduled((p) => (p ? { ...p, [key]: v } : p))} />
                  </div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <EField label="Tomorrow prep time"><EInput type="time" value={scheduled.tomorrowPrepTime} onChange={(e) => setScheduled((p) => (p ? { ...p, tomorrowPrepTime: e.target.value || p.tomorrowPrepTime } : p))} /></EField>
                <EField label="Stock alert time"><EInput type="time" value={scheduled.stockAlertsTime} onChange={(e) => setScheduled((p) => (p ? { ...p, stockAlertsTime: e.target.value || p.stockAlertsTime } : p))} /></EField>
                <EField label="Admin summary time"><EInput type="time" value={scheduled.adminAttentionSummaryTime} onChange={(e) => setScheduled((p) => (p ? { ...p, adminAttentionSummaryTime: e.target.value || p.adminAttentionSummaryTime } : p))} /></EField>
                <EField label="Laundry horizon (days)"><EInput type="number" min={1} max={120} value={scheduled.laundrySyncNotificationHorizonDays} onChange={(e) => setScheduled((p) => (p ? { ...p, laundrySyncNotificationHorizonDays: Number(e.target.value || p.laundrySyncNotificationHorizonDays) } : p))} /></EField>
              </div>
              <div className="grid gap-3">
                {CATEGORIES.map((category) => (
                  <div key={category} className="grid items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 md:grid-cols-[200px_repeat(3,minmax(0,1fr))]">
                    <div>
                      <p className="text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]">{CATEGORY_META[category].label}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{CATEGORY_META[category].description}</p>
                    </div>
                    {(["web", "email", "sms"] as const).map((channel) => (
                      <div key={`${category}-${channel}`} className="flex items-center justify-between rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] p-2">
                        <span className="text-[0.6875rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-secondary))]">{channel}</span>
                        <ESwitch checked={Boolean(defaults.categories[category][channel])} onCheckedChange={(v) => setDefaults((p) => (p ? { ...p, categories: updateMatrix(p.categories, category, channel, v) } : p))} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </ECardBody>
      </ECard>

      {/* Automatic emails */}
      <ECard>
        <ECardHeader className="flex-row items-start justify-between gap-3 pb-3">
          <div>
            <ECardTitle className="text-[0.95rem]">Automatic emails</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Master switch for every auto-sent email, plus each type individually. Manual and security emails are never affected.</p>
          </div>
          <EButton size="sm" onClick={saveControlCenter} disabled={loading || saving || !emailAutomation}>{saving ? "Saving…" : "Save email settings"}</EButton>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          {!emailAutomation ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading email settings…</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-3">
                <div>
                  <p className="text-[0.8125rem] font-semibold text-[hsl(var(--e-foreground))]">All automatic emails</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">One switch to turn every automatic email on or off.</p>
                </div>
                <ESwitch checked={emailAutomation.masterEnabled} onCheckedChange={(v) => setEmailAutomation((p) => (p ? { ...p, masterEnabled: v } : p))} />
              </div>
              <div className={`grid gap-2 sm:grid-cols-2 ${emailAutomation.masterEnabled ? "" : "opacity-50"}`}>
                {EMAIL_AUTO_KINDS.map((k) => (
                  <div key={k.key} className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                    <div className="min-w-0">
                      <p className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">{k.label}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{k.description}</p>
                    </div>
                    <ESwitch disabled={!emailAutomation.masterEnabled} checked={emailAutomation.types?.[k.key] !== false} onCheckedChange={(v) => setEmailAutomation((p) => (p ? { ...p, types: { ...p.types, [k.key]: v } } : p))} />
                  </div>
                ))}
              </div>

              {/*
                Who gets which type. The switches above are all-or-nothing, so
                the only way to stop emailing cleaners about (say) inventory was
                to stop emailing everyone about it — including the ops manager
                who needs it. Unticking a cell removes that one type from that
                one group; a type switched off above is off for everybody
                regardless, which is why those columns grey out.
              */}
              <div className={emailAutomation.masterEnabled ? "" : "opacity-50"}>
                <p className="text-[0.8125rem] font-semibold text-[hsl(var(--e-foreground))]">Who receives each type</p>
                <p className="mb-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Ticked means the group receives it. Security and manual emails are never affected.
                </p>
                {/* Wide grid: scrolls sideways inside its own box rather than
                    pushing the page out at narrow widths. */}
                <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                  <table className="w-full min-w-[42rem] border-collapse text-[0.75rem]">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-[hsl(var(--e-surface-raised))] p-2 text-left font-[550] text-[hsl(var(--e-foreground))]">
                          Email type
                        </th>
                        {NOTIFICATION_AUDIENCES.map((a) => (
                          <th key={a.key} className="p-2 text-center font-[550] text-[hsl(var(--e-muted-foreground))]">
                            {a.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {EMAIL_AUTO_KINDS.map((k) => {
                        const kindOff = emailAutomation.types?.[k.key] === false;
                        return (
                          <tr key={k.key} className="border-t border-[hsl(var(--e-border))]">
                            <td className="sticky left-0 z-10 bg-[hsl(var(--e-surface-raised))] p-2 text-[hsl(var(--e-foreground))]">
                              {k.label}
                            </td>
                            {NOTIFICATION_AUDIENCES.map((a) => (
                              <td key={a.key} className="p-2 text-center">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-[hsl(var(--e-gold))]"
                                  aria-label={`${k.label} to ${a.label}`}
                                  disabled={!emailAutomation.masterEnabled || kindOff}
                                  checked={emailAutomation.audienceKinds?.[a.key]?.[k.key] !== false}
                                  onChange={(e) => setAudienceKind(a.key, k.key, e.target.checked)}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </ECardBody>
      </ECard>

      {/*
        Per-person email. The switches above are the whole business; this is
        the one place a single person can say "not this type, not for me" —
        previously the only answer to that was to silence their entire role.
      */}
      <ECard>
        <ECardHeader className="pb-3">
          <ECardTitle className="text-[0.95rem]">Per-person email</ECardTitle>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Select people, then apply a choice. Security and password emails always send, whatever is set here.
          </p>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <EButton
              size="sm"
              variant="outline"
              onClick={() =>
                setSelectedPeople((prev) => (prev.length === users.length ? [] : users.map((u) => u.id)))
              }
            >
              {selectedPeople.length === users.length && users.length > 0 ? "Clear selection" : "Select everyone"}
            </EButton>
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {selectedPeople.length} selected
            </span>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <ESelect value={bulkKind} onChange={(e) => setBulkKind(e.target.value)}>
                {EMAIL_AUTO_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </ESelect>
              <EButton
                size="sm"
                variant="outline"
                disabled={savingPeople || selectedPeople.length === 0}
                onClick={() => applyToSelected({ kinds: { [bulkKind]: false } })}
              >
                Turn this type off
              </EButton>
              <EButton
                size="sm"
                variant="outline"
                disabled={savingPeople || selectedPeople.length === 0}
                onClick={() => applyToSelected({ kinds: { [bulkKind]: true } })}
              >
                Turn it back on
              </EButton>
              <EButton
                size="sm"
                variant="outline"
                disabled={savingPeople || selectedPeople.length === 0}
                onClick={() => applyToSelected({ allEmailOff: true })}
              >
                All email off
              </EButton>
              <EButton
                size="sm"
                variant="ghost"
                disabled={savingPeople || selectedPeople.length === 0}
                onClick={() => applyToSelected({ allEmailOff: false })}
              >
                Undo all-off
              </EButton>
            </div>
          </div>

          <div className="max-h-[22rem] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            {users.length === 0 ? (
              <p className="p-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No people to show.</p>
            ) : (
              users.map((u) => {
                const off = emailPrefs.allEmailOff.includes(u.id);
                const disabledKinds = emailPrefs.disabledKinds[u.id] ?? [];
                return (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-[hsl(var(--e-border))] p-2.5 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[hsl(var(--e-gold))]"
                      checked={selectedPeople.includes(u.id)}
                      onChange={(e) =>
                        setSelectedPeople((prev) =>
                          e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8125rem] text-[hsl(var(--e-foreground))]">
                        {u.name || u.email}
                      </span>
                      <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {u.role}
                        {off
                          ? " · all email off"
                          : disabledKinds.length > 0
                            ? ` · ${disabledKinds.length} type${disabledKinds.length === 1 ? "" : "s"} off`
                            : ""}
                      </span>
                    </span>
                    {off ? (
                      <EBadge tone="danger" soft>Off</EBadge>
                    ) : disabledKinds.length > 0 ? (
                      <EBadge tone="warning" soft>{disabledKinds.length}</EBadge>
                    ) : null}
                    {/* The bulk controls above answer "silence this kind for
                        these people". This answers "what is THIS person
                        getting?", which the count badge could only hint at.
                        preventDefault because the row is a <label>: without it
                        the click would also toggle the selection checkbox. */}
                    <EButton
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditingUser({ id: u.id, label: u.name || u.email });
                      }}
                    >
                      Edit
                    </EButton>
                  </label>
                );
              })
            )}
          </div>
        </ECardBody>
      </ECard>

      {editingUser ? (
        <UserEmailPreferencesModal
          open
          userId={editingUser.id}
          userLabel={editingUser.label}
          onClose={() => setEditingUser(null)}
          // Update the row badges in place rather than refetching the whole
          // control centre for one person's change.
          onSaved={(next) =>
            setEmailPrefs((prev) => ({
              disabledKinds: { ...prev.disabledKinds, [editingUser.id]: next.disabledKinds },
              allEmailOff: next.allEmailOff
                ? Array.from(new Set([...prev.allEmailOff, editingUser.id]))
                : prev.allEmailOff.filter((id) => id !== editingUser.id),
            }))
          }
        />
      ) : null}

      {/* Profile overrides */}
      <ECard>
        <ECardHeader className="pb-3">
          <ECardTitle className="text-[0.95rem]">Profile overrides</ECardTitle>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Staff overrides update the same per-user preference records shown inside profile settings.</p>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          <div className="inline-flex items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
            {profileBtn("admins", "Admin / Ops")}
            {profileBtn("cleaners", "Cleaners")}
            {profileBtn("laundry", "Laundry")}
            {profileBtn("clients", "Clients")}
          </div>

          {profileTab === "clients" ? (
            <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {clients.length === 0 ? (
                <p className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] px-4 py-8 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No clients found.</p>
              ) : (
                clients.map((client) => (
                  <div key={client.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">{client.name}</p>
                      <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{client.email || "No email"}{client.phone ? ` • ${client.phone}` : ""}</p>
                      <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{client._count?.properties ?? 0} properties linked</p>
                    </div>
                    <EButton size="sm" variant="outline" onClick={() => openClient(client)}><PencilLine className="h-4 w-4" />Edit</EButton>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {profileRows.length === 0 ? (
                <p className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] px-4 py-8 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No users found.</p>
              ) : (
                profileRows.map((user) => (
                  <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">{user.name || user.email}</p>
                      <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{user.email}{user.phone ? ` • ${user.phone}` : ""}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <EBadge tone="neutral">{user.role === "OPS_MANAGER" ? "Ops Manager" : user.role}</EBadge>
                        {user.notificationPreference?.updatedAt ? <EBadge tone="success" soft>Override active</EBadge> : <EBadge tone="neutral" soft>Using defaults</EBadge>}
                      </div>
                    </div>
                    <EButton size="sm" variant="outline" onClick={() => openUser(user)}><PencilLine className="h-4 w-4" />Edit</EButton>
                  </div>
                ))
              )}
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* User override modal */}
      <EModal open={Boolean(userEditor)} onClose={() => setUserEditor(null)} wide eyebrow="Overrides" title={userEditor ? `Notifications: ${userEditor.name || userEditor.email}` : "Notifications"}>
        {userEditor ? (
          <div className="space-y-4">
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {CATEGORIES.map((category) => (
                <div key={category} className="grid items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 md:grid-cols-[200px_repeat(3,minmax(0,1fr))]">
                  <div>
                    <p className="text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]">{CATEGORY_META[category].label}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{CATEGORY_META[category].description}</p>
                  </div>
                  {(["web", "email", "sms"] as const).map((channel) => (
                    <div key={`${category}-${channel}`} className="flex items-center justify-between rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] p-2">
                      <span className="text-[0.6875rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-secondary))]">{channel}</span>
                      <ESwitch checked={Boolean(userPrefs[category]?.[channel])} onCheckedChange={(v) => setUserPrefs((p) => updateMatrix(p, category, channel, v))} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <EButton variant="outline" size="sm" onClick={() => setUserEditor(null)} disabled={savingUser}>Cancel</EButton>
              <EButton size="sm" onClick={saveUserPrefs} disabled={savingUser}>{savingUser ? "Saving…" : "Save override"}</EButton>
            </div>
          </div>
        ) : null}
      </EModal>

      {/* Client override modal */}
      <EModal open={Boolean(clientEditor)} onClose={() => setClientEditor(null)} eyebrow="Overrides" title={clientEditor ? `Client updates: ${clientEditor.name}` : "Client updates"}>
        {clientEditor ? (
          <div className="space-y-4">
            {([
              ["Notifications enabled", "notificationsEnabled"],
              ["Notify when cleaner is en route", "notifyOnEnRoute"],
              ["Notify when job starts", "notifyOnJobStart"],
              ["Notify when job completes", "notifyOnJobComplete"],
            ] as const).map(([label, key]) => (
              <div key={key} className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">{label}</span>
                <ESwitch checked={clientPrefs[key]} onCheckedChange={(v) => setClientPrefs((p) => ({ ...p, [key]: v }))} />
              </div>
            ))}
            <EField label="Preferred channel">
              <ESelect value={clientPrefs.preferredChannel} onChange={(e) => setClientPrefs((p) => ({ ...p, preferredChannel: e.target.value as ClientPref["preferredChannel"] }))}>
                <option value="EMAIL">Email only</option>
                <option value="SMS">SMS only</option>
                <option value="BOTH">Email and SMS</option>
              </ESelect>
            </EField>
            <div className="flex justify-end gap-2">
              <EButton variant="outline" size="sm" onClick={() => setClientEditor(null)} disabled={savingClient}>Cancel</EButton>
              <EButton size="sm" onClick={saveClientPrefs} disabled={savingClient}>{savingClient ? "Saving…" : "Save client override"}</EButton>
            </div>
          </div>
        ) : null}
      </EModal>
    </div>
  );
}
