"use client";

/**
 * ESTATE property detail — v2-native replacement for the v1 property detail
 * page (app/admin/properties/[id]). Same endpoints:
 *   GET   /api/admin/properties/:id
 *   PATCH /api/admin/properties/:id
 *   PATCH /api/admin/properties/:id/integration       (save iCal)
 *   POST  /api/admin/properties/:id/integration       (trigger sync)
 *   POST  /api/admin/properties/:id/integration/undo  (undo run)
 *   GET/POST/DELETE /api/admin/properties/:id/pending-tasks[/:taskId]
 *   POST  /api/admin/inventory/property/:id/set-levels
 * Estate token scope only; no components/ui/* dependency.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bath,
  Bed,
  Building2,
  Camera,
  ClipboardList,
  FileText,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  ESwitch,
  ETextarea,
  EConfirmModal,
  EModal,
} from "@/components/v2/admin/estate-kit";
import { PropertyBillingRates } from "./property-billing-rates";
import { PropertyChecklistProfile, PropertyFormOverrides } from "./property-checklist-profile";
import { PropertyAccessGuideEditor } from "./property-access-guide-editor";

type TabKey = "profile" | "jobs" | "checklist" | "access" | "inventory" | "billing";

const SYNC_TONE: Record<string, "success" | "danger" | "info" | "neutral"> = {
  SUCCESS: "success",
  ERROR: "danger",
  SYNCING: "info",
  IDLE: "neutral",
};

function titleCase(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function PropertyDetail({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [property, setProperty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);
  const [tab, setTab] = useState<TabKey>("profile");

  // Edit form
  const [form, setForm] = useState({
    name: "",
    address: "",
    suburb: "",
    state: "NSW",
    postcode: "",
    notes: "",
    linenBufferSets: "0",
    inventoryEnabled: false,
    laundryEnabled: true,
    defaultCheckinTime: "14:00",
    defaultCheckoutTime: "10:00",
    hasBalcony: false,
    bedrooms: "1",
    bathrooms: "1",
    showCleanerContactToClient: false,
  });
  const [access, setAccess] = useState({
    lockbox: "",
    codes: "",
    parking: "",
    other: "",
    instructions: "",
  });
  const [savingProperty, setSavingProperty] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Integration
  const [icalUrl, setIcalUrl] = useState("");
  const [icalEnabled, setIcalEnabled] = useState(false);
  const [savingIntegration, setSavingIntegration] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [undoingRunId, setUndoingRunId] = useState<string | null>(null);

  // Checklist / pending tasks
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", requiresPhoto: false, requiresNote: false });
  const [savingTask, setSavingTask] = useState(false);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);

  // Inventory stock draft
  const [stockDraft, setStockDraft] = useState<
    Record<string, { onHand: string; parLevel: string; reorderThreshold: string }>
  >({});
  const [savingStock, setSavingStock] = useState(false);

  const loadProperty = useCallback(async () => {
    const res = await fetch(`/api/admin/properties/${propertyId}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      setNotFoundState(true);
      setLoading(false);
      return;
    }
    setProperty(data);
    setIcalUrl(data.integration?.icalUrl ?? "");
    setIcalEnabled(data.integration?.isEnabled ?? false);

    const acc = (data.accessInfo ?? {}) as Record<string, any>;
    setAccess({
      lockbox: typeof acc.lockbox === "string" ? acc.lockbox : "",
      codes: typeof acc.codes === "string" ? acc.codes : "",
      parking: typeof acc.parking === "string" ? acc.parking : "",
      other: typeof acc.other === "string" ? acc.other : "",
      instructions: typeof acc.instructions === "string" ? acc.instructions : "",
    });
    setForm({
      name: data.name ?? "",
      address: data.address ?? "",
      suburb: data.suburb ?? "",
      state: data.state ?? "NSW",
      postcode: data.postcode ?? "",
      notes: data.notes ?? "",
      linenBufferSets: String(data.linenBufferSets ?? 0),
      inventoryEnabled: Boolean(data.inventoryEnabled),
      laundryEnabled: data.laundryEnabled !== false,
      defaultCheckinTime: data.defaultCheckinTime ?? "14:00",
      defaultCheckoutTime: data.defaultCheckoutTime ?? "10:00",
      hasBalcony: Boolean(data.hasBalcony),
      bedrooms: String(data.bedrooms ?? 1),
      bathrooms: String(data.bathrooms ?? 1),
      showCleanerContactToClient: Boolean(data.showCleanerContactToClient),
    });

    const draft: Record<string, { onHand: string; parLevel: string; reorderThreshold: string }> = {};
    for (const row of data.propertyStock ?? []) {
      draft[row.itemId] = {
        onHand: String(row.onHand ?? 0),
        parLevel: String(row.parLevel ?? 0),
        reorderThreshold: String(row.reorderThreshold ?? 0),
      };
    }
    setStockDraft(draft);
    setLoading(false);
  }, [propertyId]);

  const loadPendingTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/pending-tasks`);
      const data = await res.json().catch(() => []);
      setPendingTasks(Array.isArray(data) ? data : []);
    } finally {
      setLoadingTasks(false);
    }
  }, [propertyId]);

  useEffect(() => {
    loadProperty();
    loadPendingTasks();
  }, [loadProperty, loadPendingTasks]);

  function setF<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveProperty() {
    setSavingProperty(true);
    const payload = {
      name: form.name,
      address: form.address,
      suburb: form.suburb,
      state: form.state || "NSW",
      postcode: form.postcode || undefined,
      notes: form.notes || undefined,
      accessInfo: {
        lockbox: access.lockbox || undefined,
        codes: access.codes || undefined,
        parking: access.parking || undefined,
        other: access.other || undefined,
        instructions: access.instructions || undefined,
      },
      linenBufferSets: Number(form.linenBufferSets || 0),
      inventoryEnabled: form.inventoryEnabled,
      laundryEnabled: form.laundryEnabled,
      defaultCheckinTime: form.defaultCheckinTime,
      defaultCheckoutTime: form.defaultCheckoutTime,
      hasBalcony: form.hasBalcony,
      bedrooms: Number(form.bedrooms || 0),
      bathrooms: Number(form.bathrooms || 0),
      showCleanerContactToClient: form.showCleanerContactToClient,
    };
    const res = await fetch(`/api/admin/properties/${propertyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingProperty(false);
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Could not update property.", variant: "destructive" });
      return;
    }
    toast({ title: "Property updated" });
    loadProperty();
  }

  async function deleteProperty(credentials?: { pin?: string; password?: string }) {
    setDeleting(true);
    const res = await fetch(`/api/admin/properties/${propertyId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ security: credentials }),
    });
    const body = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not deactivate property.", variant: "destructive" });
      return;
    }
    toast({ title: "Property deactivated" });
    setDeleteOpen(false);
    router.push("/v2/admin/properties");
    router.refresh();
  }

  async function saveIntegration() {
    setSavingIntegration(true);
    const res = await fetch(`/api/admin/properties/${propertyId}/integration`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icalUrl: icalUrl || null, isEnabled: icalEnabled }),
    });
    setSavingIntegration(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Save failed", description: err.error ?? "Could not save integration.", variant: "destructive" });
      return;
    }
    toast({ title: "Integration saved" });
    loadProperty();
  }

  async function triggerSync() {
    setSyncing(true);
    const res = await fetch(`/api/admin/properties/${propertyId}/integration`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSyncing(false);
    if (!res.ok) {
      toast({ title: "Sync failed", description: body.error ?? "Could not trigger sync.", variant: "destructive" });
      return;
    }
    const s = body.summary ?? {};
    toast({
      title: "Sync completed",
      description: `${s.reservationsCreated ?? 0} reservations, ${s.jobsCreated ?? 0} jobs created, ${s.jobsUpdated ?? 0} updated.`,
    });
    loadProperty();
  }

  async function undoSyncRun(runId: string) {
    setUndoingRunId(runId);
    const res = await fetch(`/api/admin/properties/${propertyId}/integration/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    const body = await res.json().catch(() => ({}));
    setUndoingRunId(null);
    if (!res.ok) {
      toast({ title: "Undo failed", description: body.error ?? "Could not undo sync run.", variant: "destructive" });
      return;
    }
    toast({ title: "Sync reverted" });
    loadProperty();
  }

  async function addTask() {
    if (!taskForm.title.trim()) return;
    setSavingTask(true);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/pending-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskForm.title.trim(),
          description: taskForm.description.trim() || undefined,
          requiresPhoto: taskForm.requiresPhoto,
          requiresNote: taskForm.requiresNote,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Failed to add task", description: err.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      setTaskForm({ title: "", description: "", requiresPhoto: false, requiresNote: false });
      setAddTaskOpen(false);
      await loadPendingTasks();
      toast({ title: "Task added", description: "Will attach to the next upcoming job for this property." });
    } finally {
      setSavingTask(false);
    }
  }

  async function cancelTask(taskId: string) {
    setCancellingTaskId(taskId);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/pending-tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Failed to cancel task", description: err.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      await loadPendingTasks();
      toast({ title: "Task cancelled" });
    } finally {
      setCancellingTaskId(null);
    }
  }

  async function saveStockLevels() {
    if (!property) return;
    setSavingStock(true);
    const rows = Array.isArray(property.propertyStock) ? property.propertyStock : [];
    const levels = rows.map((row: any) => {
      const draft = stockDraft[row.itemId] ?? {
        onHand: String(row.onHand ?? 0),
        parLevel: String(row.parLevel ?? 0),
        reorderThreshold: String(row.reorderThreshold ?? 0),
      };
      return {
        itemId: row.itemId,
        onHand: Number(draft.onHand || 0),
        parLevel: Number(draft.parLevel || 0),
        reorderThreshold: Number(draft.reorderThreshold || 0),
      };
    });
    const res = await fetch(`/api/admin/inventory/property/${propertyId}/set-levels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ levels }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingStock(false);
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Could not save stock levels.", variant: "destructive" });
      return;
    }
    toast({ title: "Stock levels updated" });
    loadProperty();
  }

  const syncRuns = useMemo(
    () => (Array.isArray(property?.integration?.syncRuns) ? property.integration.syncRuns : []),
    [property],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        Loading property…
      </div>
    );
  }

  if (notFoundState || !property) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <EButton asChild variant="ghost" size="icon">
            <Link href="/v2/admin/properties" aria-label="Back to portfolio">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </EButton>
        </div>
        <EEmptyState
          eyebrow="Not found"
          title="Property unavailable"
          description="This property could not be loaded. It may have been removed."
          action={
            <EButton asChild variant="outline">
              <Link href="/v2/admin/properties">Back to portfolio</Link>
            </EButton>
          }
        />
      </div>
    );
  }

  const stockRows = Array.isArray(property.propertyStock) ? property.propertyStock : [];
  const jobCount = property._count?.jobs ?? 0;
  const reservationCount = property._count?.reservations ?? 0;

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode; count?: number }> = [
    { key: "profile", label: "Profile & edit", icon: <Building2 className="h-3.5 w-3.5" /> },
    { key: "jobs", label: "Jobs & history", icon: <FileText className="h-3.5 w-3.5" />, count: jobCount },
    { key: "checklist", label: "Checklist", icon: <ClipboardList className="h-3.5 w-3.5" />, count: pendingTasks.length },
    { key: "access", label: "Access guide", icon: <KeyRound className="h-3.5 w-3.5" /> },
    { key: "inventory", label: "Inventory", icon: <ClipboardList className="h-3.5 w-3.5" />, count: stockRows.length },
    { key: "billing", label: "Billing rates", icon: <FileText className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <EButton asChild variant="ghost" size="icon">
          <Link href="/v2/admin/properties" aria-label="Back to portfolio">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </EButton>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Properties</span>
      </div>

      <EPageHeader
        eyebrow="Property"
        title={property.name}
        description={[property.suburb, property.client?.name ? `Client ${property.client.name}` : null]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <EButton asChild variant="outline" size="sm">
              <Link href={`/v2/admin/properties/new?copyFrom=${property.id}`}>Copy</Link>
            </EButton>
            <EButton variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Deactivate
            </EButton>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Bedrooms" value={property.bedrooms ?? 0} icon={<Bed className="h-4 w-4" />} />
        <EStatCard label="Bathrooms" value={property.bathrooms ?? 0} icon={<Bath className="h-4 w-4" />} />
        <EStatCard label="Jobs (all time)" value={jobCount} icon={<FileText className="h-4 w-4" />} />
        <EStatCard label="Reservations" value={reservationCount} icon={<RefreshCw className="h-4 w-4" />} />
      </section>

      {/* Tab bar */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex min-w-full items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] tracking-[0.01em] transition-colors duration-[160ms] " +
                (tab === t.key
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {t.icon}
              {t.label}
              {typeof t.count === "number" ? (
                <span
                  className={
                    "e-tnum rounded-[var(--e-radius-pill)] px-1.5 text-[0.6875rem] " +
                    (tab === t.key
                      ? "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                      : "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]")
                  }
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* PROFILE / EDIT */}
      {tab === "profile" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <ECard className="lg:col-span-2">
            <ECardHeader className="pb-2">
              <ECardTitle className="text-[0.95rem]">Profile</ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-4 pt-0">
              <div className="grid gap-4 md:grid-cols-2">
                <EField label="Property name">
                  <EInput value={form.name} onChange={(e) => setF("name", e.target.value)} />
                </EField>
                <EField label="Suburb">
                  <EInput value={form.suburb} onChange={(e) => setF("suburb", e.target.value)} />
                </EField>
              </div>
              <EField label="Address">
                <EInput value={form.address} onChange={(e) => setF("address", e.target.value)} />
              </EField>
              <div className="grid gap-4 md:grid-cols-3">
                <EField label="State">
                  <EInput maxLength={3} value={form.state} onChange={(e) => setF("state", e.target.value.toUpperCase())} />
                </EField>
                <EField label="Postcode">
                  <EInput inputMode="numeric" maxLength={4} value={form.postcode} onChange={(e) => setF("postcode", e.target.value)} />
                </EField>
                <EField label="Linen buffer sets">
                  <EInput type="number" min="0" value={form.linenBufferSets} onChange={(e) => setF("linenBufferSets", e.target.value)} />
                </EField>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <EField label="Bedrooms">
                  <EInput type="number" min="0" value={form.bedrooms} onChange={(e) => setF("bedrooms", e.target.value)} />
                </EField>
                <EField label="Bathrooms">
                  <EInput type="number" min="0" value={form.bathrooms} onChange={(e) => setF("bathrooms", e.target.value)} />
                </EField>
                <EField label="Check-in time">
                  <EInput type="time" value={form.defaultCheckinTime} onChange={(e) => setF("defaultCheckinTime", e.target.value)} />
                </EField>
                <EField label="Checkout time">
                  <EInput type="time" value={form.defaultCheckoutTime} onChange={(e) => setF("defaultCheckoutTime", e.target.value)} />
                </EField>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <ToggleTile title="Has balcony" hint="Enable balcony checklist fields." checked={form.hasBalcony} onChange={(v) => setF("hasBalcony", v)} />
                <ToggleTile title="Inventory enabled" hint="Track stock for this property." checked={form.inventoryEnabled} onChange={(v) => setF("inventoryEnabled", v)} />
                <ToggleTile title="Laundry service" hint="Exclude from laundry scheduling when off." checked={form.laundryEnabled} onChange={(v) => setF("laundryEnabled", v)} />
                <ToggleTile title="Show cleaner contact to client" hint="Reveal assigned cleaner's contact." checked={form.showCleanerContactToClient} onChange={(v) => setF("showCleanerContactToClient", v)} />
              </div>

              <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.8125rem] font-[550]">Access & instructions</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <EField label="Lockbox">
                    <EInput value={access.lockbox} onChange={(e) => setAccess((p) => ({ ...p, lockbox: e.target.value }))} />
                  </EField>
                  <EField label="Access codes">
                    <EInput value={access.codes} onChange={(e) => setAccess((p) => ({ ...p, codes: e.target.value }))} />
                  </EField>
                  <EField label="Parking">
                    <EInput value={access.parking} onChange={(e) => setAccess((p) => ({ ...p, parking: e.target.value }))} />
                  </EField>
                  <EField label="Other">
                    <EInput value={access.other} onChange={(e) => setAccess((p) => ({ ...p, other: e.target.value }))} />
                  </EField>
                </div>
                <EField label="Access instructions">
                  <ETextarea value={access.instructions} onChange={(e) => setAccess((p) => ({ ...p, instructions: e.target.value }))} />
                </EField>
              </div>

              <EField label="Notes">
                <ETextarea value={form.notes} onChange={(e) => setF("notes", e.target.value)} />
              </EField>

              <div className="flex justify-end">
                <EButton variant="gold" onClick={saveProperty} disabled={savingProperty}>
                  <Save className="mr-1 h-3.5 w-3.5" /> {savingProperty ? "Saving…" : "Save changes"}
                </EButton>
              </div>
            </ECardBody>
          </ECard>

          {/* iCal integration */}
          <ECard className="lg:col-span-1">
            <ECardHeader className="pb-2">
              <ECardTitle className="text-[0.95rem]">iCal sync</ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-3 pt-0">
              <div className="flex items-center justify-between">
                <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Enabled</span>
                <ESwitch checked={icalEnabled} onCheckedChange={setIcalEnabled} />
              </div>
              <EField label="iCal URL">
                <EInput value={icalUrl} placeholder="https://…" onChange={(e) => setIcalUrl(e.target.value)} />
              </EField>
              {property.integration?.syncStatus ? (
                <div className="flex items-center gap-2 text-[0.75rem]">
                  <span className="text-[hsl(var(--e-text-faint))]">Status</span>
                  <EBadge tone={SYNC_TONE[property.integration.syncStatus] ?? "neutral"} soft>
                    {titleCase(property.integration.syncStatus)}
                  </EBadge>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <EButton variant="outline" size="sm" onClick={saveIntegration} disabled={savingIntegration}>
                  {savingIntegration ? "Saving…" : "Save"}
                </EButton>
                <EButton variant="primary" size="sm" onClick={triggerSync} disabled={syncing || !icalEnabled}>
                  <RefreshCw className={"mr-1 h-3.5 w-3.5 " + (syncing ? "animate-spin" : "")} />
                  {syncing ? "Syncing…" : "Sync now"}
                </EButton>
              </div>

              {syncRuns.length > 0 ? (
                <div className="space-y-2 border-t border-[hsl(var(--e-border))] pt-3">
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
                    Recent runs
                  </p>
                  {syncRuns.map((run: any) => (
                    <div key={run.id} className="flex items-center justify-between gap-2 text-[0.75rem]">
                      <div className="min-w-0">
                        <p className="truncate text-[hsl(var(--e-text-secondary))]">
                          {run.createdAt ? new Date(run.createdAt).toLocaleString("en-AU") : "—"}
                        </p>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {titleCase(run.status)}
                          {run.revertedAt ? " · reverted" : ""}
                        </p>
                      </div>
                      {!run.revertedAt ? (
                        <EButton
                          variant="ghost"
                          size="sm"
                          disabled={undoingRunId === run.id}
                          onClick={() => undoSyncRun(run.id)}
                        >
                          {undoingRunId === run.id ? "Undoing…" : "Undo"}
                        </EButton>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </ECardBody>
          </ECard>
        </div>
      ) : null}

      {/* JOBS & HISTORY */}
      {tab === "jobs" ? <PropertyJobs propertyId={propertyId} /> : null}

      {/* ACCESS GUIDE */}
      {tab === "access" ? <PropertyAccessGuideEditor propertyId={propertyId} /> : null}

      {/* BILLING RATES */}
      {tab === "billing" ? <PropertyBillingRates propertyId={propertyId} /> : null}

      {/* CHECKLIST */}
      {tab === "checklist" ? (
        <div className="space-y-4">
        {/* Per-property dynamic checklist: amenities → toggled sections/items →
            live preview → approve generates this property's own form. */}
        <PropertyChecklistProfile propertyId={propertyId} />
        <PropertyFormOverrides propertyId={propertyId} />
        <ECard>
          <ECardHeader className="flex-row items-center justify-between pb-2">
            <ECardTitle className="text-[0.95rem]">Next-job checklist</ECardTitle>
            <EButton variant="gold" size="sm" onClick={() => setAddTaskOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add task
            </EButton>
          </ECardHeader>
          <ECardBody className="pt-0">
            {loadingTasks ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading tasks…</p>
            ) : pendingTasks.length === 0 ? (
              <EEmptyState
                eyebrow="No tasks"
                title="Nothing queued"
                description="Add a one-off task and it will attach to this property's next upcoming job."
              />
            ) : (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {pendingTasks.map((task) => (
                  <li key={task.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-[550] text-[0.875rem]">{task.title}</p>
                      {task.description ? (
                        <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{task.description}</p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {task.requiresPhoto ? (
                          <EBadge tone="info" soft>
                            <Camera className="h-2.5 w-2.5" /> Photo
                          </EBadge>
                        ) : null}
                        {task.requiresNote ? (
                          <EBadge tone="neutral" soft>
                            <FileText className="h-2.5 w-2.5" /> Note
                          </EBadge>
                        ) : null}
                      </div>
                    </div>
                    <EButton
                      variant="ghost"
                      size="sm"
                      disabled={cancellingTaskId === task.id}
                      onClick={() => cancelTask(task.id)}
                    >
                      {cancellingTaskId === task.id ? "Cancelling…" : "Cancel"}
                    </EButton>
                  </li>
                ))}
              </ul>
            )}
          </ECardBody>
        </ECard>
        </div>
      ) : null}

      {/* INVENTORY */}
      {tab === "inventory" ? (
        <ECard>
          <ECardHeader className="flex-row items-center justify-between pb-2">
            <ECardTitle className="text-[0.95rem]">Property stock levels</ECardTitle>
            {stockRows.length > 0 ? (
              <EButton variant="gold" size="sm" onClick={saveStockLevels} disabled={savingStock}>
                <Save className="mr-1 h-3.5 w-3.5" /> {savingStock ? "Saving…" : "Save levels"}
              </EButton>
            ) : null}
          </ECardHeader>
          <ECardBody className="pt-0">
            {stockRows.length === 0 ? (
              <EEmptyState
                eyebrow="No stock"
                title="Inventory not tracked"
                description="Enable inventory on the profile tab and add items to track stock for this property."
              />
            ) : (
              <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                <table className="w-full text-[0.8125rem]">
                  <thead>
                    <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                      {["Item", "On hand", "Par level", "Reorder at"].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stockRows.map((row: any) => {
                      const draft = stockDraft[row.itemId] ?? {
                        onHand: String(row.onHand ?? 0),
                        parLevel: String(row.parLevel ?? 0),
                        reorderThreshold: String(row.reorderThreshold ?? 0),
                      };
                      const setDraft = (patch: Partial<typeof draft>) =>
                        setStockDraft((prev) => ({ ...prev, [row.itemId]: { ...draft, ...patch } }));
                      return (
                        <tr key={row.itemId} className="border-t border-[hsl(var(--e-border)/0.7)]">
                          <td className="px-3 py-2">
                            <p className="font-[550]">{row.item?.name ?? "Item"}</p>
                            <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                              {[row.item?.category, row.item?.unit].filter(Boolean).join(" · ")}
                            </p>
                          </td>
                          <td className="px-3 py-2">
                            <EInput
                              type="number"
                              min="0"
                              className="h-9 w-24"
                              value={draft.onHand}
                              onChange={(e) => setDraft({ onHand: e.target.value })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <EInput
                              type="number"
                              min="0"
                              className="h-9 w-24"
                              value={draft.parLevel}
                              onChange={(e) => setDraft({ parLevel: e.target.value })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <EInput
                              type="number"
                              min="0"
                              className="h-9 w-24"
                              value={draft.reorderThreshold}
                              onChange={(e) => setDraft({ reorderThreshold: e.target.value })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Add task modal */}
      <EModal open={addTaskOpen} onClose={() => setAddTaskOpen(false)} title="Add checklist task" eyebrow="Next job">
        <div className="space-y-4">
          <EField label="Title">
            <EInput
              value={taskForm.title}
              onChange={(e) => setTaskForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Replace batteries in smoke alarm"
            />
          </EField>
          <EField label="Description">
            <ETextarea
              value={taskForm.description}
              onChange={(e) => setTaskForm((p) => ({ ...p, description: e.target.value }))}
            />
          </EField>
          <div className="flex flex-wrap gap-4">
            <ESwitch
              checked={taskForm.requiresPhoto}
              onCheckedChange={(v) => setTaskForm((p) => ({ ...p, requiresPhoto: v }))}
              label="Requires photo"
            />
            <ESwitch
              checked={taskForm.requiresNote}
              onCheckedChange={(v) => setTaskForm((p) => ({ ...p, requiresNote: v }))}
              label="Requires note"
            />
          </div>
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setAddTaskOpen(false)}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={addTask} disabled={savingTask || !taskForm.title.trim()}>
              {savingTask ? "Adding…" : "Add task"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Deactivate confirm */}
      <EConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Deactivate property"
        description="This deactivates the property so it no longer appears in the active portfolio. Jobs and history are retained."
        confirmLabel="Deactivate"
        requireSecurity
        loading={deleting}
        onConfirm={deleteProperty}
      />
    </div>
  );
}

function ToggleTile({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-[550]">{title}</p>
        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{hint}</p>
      </div>
      <ESwitch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* Jobs & history — pulls the same /api/admin/properties/:id/jobs feed the v1 tab used. */
function PropertyJobs({ propertyId }: { propertyId: string }) {
  const [jobs, setJobs] = useState<any[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/properties/${propertyId}/jobs`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        setJobs(Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : []);
      })
      .catch(() => {
        if (!cancelled) setJobs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  if (jobs === null) {
    return (
      <ECard>
        <ECardBody className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading jobs…
        </ECardBody>
      </ECard>
    );
  }

  if (jobs.length === 0) {
    return (
      <EEmptyState eyebrow="No jobs" title="Nothing scheduled yet" description="This property's jobs will appear here." />
    );
  }

  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[0.95rem]">Jobs & history</ECardTitle>
      </ECardHeader>
      <ECardBody className="pt-0">
        <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                {["Date", "Job", "Service", "Status", ""].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((j: any) => (
                <tr key={j.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                  <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                    {j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString("en-AU") : "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{j.jobNumber ?? j.id?.slice(0, 8)}</td>
                  <td className="px-3 py-2.5 text-[hsl(var(--e-text-secondary))]">{titleCase(j.jobType)}</td>
                  <td className="px-3 py-2.5">
                    <EBadge tone="neutral" soft>
                      {titleCase(j.status)}
                    </EBadge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <EButton asChild variant="ghost" size="sm">
                      <Link href={`/v2/admin/jobs/${j.id}`}>Open</Link>
                    </EButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ECardBody>
    </ECard>
  );
}
