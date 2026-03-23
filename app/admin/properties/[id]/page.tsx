"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { JobType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  PropertyAccessFields,
  buildGoogleMapsUrl,
  type PropertyAccessInfo,
} from "@/components/admin/property-access-fields";
import { GoogleAddressInput } from "@/components/shared/google-address-input";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { ArrowLeft, RefreshCw, AlertTriangle, CheckCircle, Clock, Trash2, Save, Copy, MapPinned } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PropertyClientRateEditor } from "@/components/admin/property-client-rate-editor";
import { format } from "date-fns";
import {
  INVENTORY_LOCATIONS,
  INVENTORY_LOCATION_LABELS,
  normalizeInventoryLocation,
  type InventoryLocation,
} from "@/lib/inventory/locations";
import { DEFAULT_ICAL_SYNC_OPTIONS, parseIntegrationNotes, type IcalSyncOptions } from "@/lib/ical/options";

type FormTemplateOption = {
  id: string;
  name: string;
  version: number;
};

function jobTypeLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function PropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [property, setProperty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [icalUrl, setIcalUrl] = useState("");
  const [icalEnabled, setIcalEnabled] = useState(false);
  const [savingIntegration, setSavingIntegration] = useState(false);
  const [undoingSyncRunId, setUndoingSyncRunId] = useState<string | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [savingStock, setSavingStock] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingProperty, setDeletingProperty] = useState(false);
  const [stockDraft, setStockDraft] = useState<Record<string, { onHand: string; parLevel: string; reorderThreshold: string }>>({});
  const [stockRows, setStockRows] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [defaultInventoryItems, setDefaultInventoryItems] = useState<any[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [addingPreset, setAddingPreset] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [customItem, setCustomItem] = useState({
    name: "",
    category: "Custom",
    location: "CLEANERS_CUPBOARD" as InventoryLocation,
    unit: "unit",
    supplier: "",
    onHand: "0",
    parLevel: "6",
    reorderThreshold: "2",
  });
  const [loadingFormOverrides, setLoadingFormOverrides] = useState(true);
  const [savingFormOverrides, setSavingFormOverrides] = useState(false);
  const [formTemplateJobTypes, setFormTemplateJobTypes] = useState<JobType[]>(Object.values(JobType));
  const [formTemplateOptionsByJobType, setFormTemplateOptionsByJobType] = useState<
    Record<string, FormTemplateOption[]>
  >({});
  const [formTemplateGlobalDefaults, setFormTemplateGlobalDefaults] = useState<Record<string, string>>({});
  const [formTemplateOverrides, setFormTemplateOverrides] = useState<Record<string, string>>({});
  const [accessInfo, setAccessInfo] = useState<PropertyAccessInfo>({
    lockbox: "",
    codes: "",
    parking: "",
    other: "",
    instructions: "",
    attachments: [],
  });
  const [syncOptions, setSyncOptions] = useState<IcalSyncOptions>({ ...DEFAULT_ICAL_SYNC_OPTIONS });
  const [form, setForm] = useState({
    name: "",
    address: "",
    suburb: "",
    state: "NSW",
    postcode: "",
    notes: "",
    linenBufferSets: "0",
    defaultCleanDurationHours: "3",
    maxGuestCount: "4",
    inventoryEnabled: false,
    defaultCheckinTime: "14:00",
    defaultCheckoutTime: "10:00",
    hasBalcony: false,
    bedrooms: "1",
    bathrooms: "1",
  });

  async function loadProperty() {
    const res = await fetch(`/api/admin/properties/${params.id}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      setProperty(null);
      setLoading(false);
      return;
    }
    setProperty(data);
    setIcalUrl(data.integration?.icalUrl ?? "");
    setIcalEnabled(data.integration?.isEnabled ?? false);
    setSyncOptions(parseIntegrationNotes(data.integration?.notes).syncOptions);
    const access = (data.accessInfo ?? {}) as Record<string, unknown>;
    setAccessInfo({
      lockbox: typeof access.lockbox === "string" ? access.lockbox : "",
      codes: typeof access.codes === "string" ? access.codes : "",
      parking: typeof access.parking === "string" ? access.parking : "",
      other: typeof access.other === "string" ? access.other : "",
      instructions: typeof access.instructions === "string" ? access.instructions : "",
      attachments: Array.isArray(access.attachments)
        ? access.attachments
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
            .map((item) => ({
              name: typeof item.name === "string" ? item.name : "Attachment",
              url: typeof item.url === "string" ? item.url : "",
              key: typeof item.key === "string" ? item.key : undefined,
              contentType: typeof item.contentType === "string" ? item.contentType : undefined,
            }))
            .filter((item) => item.url)
        : [],
    });
    setForm({
      name: data.name ?? "",
      address: data.address ?? "",
      suburb: data.suburb ?? "",
      state: data.state ?? "NSW",
      postcode: data.postcode ?? "",
      notes: data.notes ?? "",
      linenBufferSets: String(data.linenBufferSets ?? 0),
      defaultCleanDurationHours:
        typeof access.defaultCleanDurationHours === "number"
          ? String(access.defaultCleanDurationHours)
          : "3",
      maxGuestCount:
        typeof access.maxGuestCount === "number"
          ? String(access.maxGuestCount)
          : "4",
      inventoryEnabled: Boolean(data.inventoryEnabled),
      defaultCheckinTime: data.defaultCheckinTime ?? "14:00",
      defaultCheckoutTime: data.defaultCheckoutTime ?? "10:00",
      hasBalcony: Boolean(data.hasBalcony),
      bedrooms: String(data.bedrooms ?? 1),
      bathrooms: String(data.bathrooms ?? 1),
    });
    const draft: Record<string, { onHand: string; parLevel: string; reorderThreshold: string }> = {};
    for (const row of data.propertyStock ?? []) {
      draft[row.itemId] = {
        onHand: String(row.onHand ?? 0),
        parLevel: String(row.parLevel ?? 0),
        reorderThreshold: String(row.reorderThreshold ?? 0),
      };
    }
    setStockRows(Array.isArray(data.propertyStock) ? data.propertyStock : []);
    setStockDraft(draft);
    setLoading(false);
  }

  async function loadInventoryCatalog() {
    const [itemsRes, defaultsRes] = await Promise.all([
      fetch("/api/admin/inventory/items"),
      fetch("/api/admin/inventory/defaults"),
    ]);
    const [itemsBody, defaultsBody] = await Promise.all([
      itemsRes.json().catch(() => []),
      defaultsRes.json().catch(() => []),
    ]);
    const items = Array.isArray(itemsBody)
      ? itemsBody.map((row: any) => ({ ...row, location: normalizeInventoryLocation(row?.location) }))
      : [];
    const defaults = Array.isArray(defaultsBody)
      ? defaultsBody.map((row: any) => ({ ...row, location: normalizeInventoryLocation(row?.location) }))
      : [];
    setInventoryItems(items);
    setDefaultInventoryItems(defaults);
    const currentIds = new Set(
      (Array.isArray(stockRows) ? stockRows : [])
        .map((row: any) => row?.itemId)
        .filter(Boolean)
    );
    const firstAvailablePreset = defaults.find((item: any) => !currentIds.has(item.id));
    setSelectedPresetId(firstAvailablePreset?.id ?? defaults[0]?.id ?? "");
  }

  async function loadFormOverrides() {
    setLoadingFormOverrides(true);
    try {
      const res = await fetch(`/api/admin/properties/${params.id}/form-overrides`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not load property form defaults.");
      }
      const parsedJobTypes = Array.isArray(body.jobTypes)
        ? body.jobTypes.filter((value: unknown): value is JobType =>
            typeof value === "string" && (Object.values(JobType) as string[]).includes(value)
          )
        : [];
      setFormTemplateJobTypes(parsedJobTypes.length > 0 ? parsedJobTypes : Object.values(JobType));
      setFormTemplateOptionsByJobType(
        body.templatesByJobType && typeof body.templatesByJobType === "object"
          ? body.templatesByJobType
          : {}
      );
      setFormTemplateGlobalDefaults(
        body.globalDefaults && typeof body.globalDefaults === "object"
          ? body.globalDefaults
          : {}
      );
      setFormTemplateOverrides(body.overrides && typeof body.overrides === "object" ? body.overrides : {});
    } catch (err: any) {
      toast({
        title: "Could not load form defaults",
        description: err.message ?? "Please refresh and try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingFormOverrides(false);
    }
  }

  useEffect(() => {
    loadProperty();
    loadInventoryCatalog();
    loadFormOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    const currentIds = new Set((stockRows ?? []).map((row: any) => row?.itemId).filter(Boolean));
    if (!selectedPresetId || currentIds.has(selectedPresetId)) {
      const next = defaultInventoryItems.find((item: any) => !currentIds.has(item.id));
      if (next?.id && next.id !== selectedPresetId) {
        setSelectedPresetId(next.id);
      }
    }
  }, [stockRows, defaultInventoryItems, selectedPresetId]);

  async function saveProperty() {
    setSavingProperty(true);
    const normalizedAttachments = (accessInfo.attachments ?? []).filter((item) => item.url);
    const payload = {
      name: form.name,
      address: form.address,
      suburb: form.suburb,
      state: form.state,
      postcode: form.postcode || undefined,
      notes: form.notes || undefined,
      accessInfo:
        Number(form.defaultCleanDurationHours) > 0 ||
        Number(form.maxGuestCount) > 0 ||
        accessInfo.lockbox ||
        accessInfo.codes ||
        accessInfo.parking ||
        accessInfo.other ||
        accessInfo.instructions ||
        normalizedAttachments.length > 0
          ? {
              ...(Number(form.defaultCleanDurationHours) > 0
                ? { defaultCleanDurationHours: Number(form.defaultCleanDurationHours) }
                : {}),
              ...(Number(form.maxGuestCount) > 0
                ? { maxGuestCount: Number(form.maxGuestCount) }
                : {}),
              lockbox: accessInfo.lockbox || undefined,
              codes: accessInfo.codes || undefined,
              parking: accessInfo.parking || undefined,
              other: accessInfo.other || undefined,
              instructions: accessInfo.instructions || undefined,
              attachments: normalizedAttachments.length > 0 ? normalizedAttachments : undefined,
            }
          : null,
      linenBufferSets: Number(form.linenBufferSets || 0),
      inventoryEnabled: form.inventoryEnabled,
      defaultCheckinTime: form.defaultCheckinTime,
      defaultCheckoutTime: form.defaultCheckoutTime,
      hasBalcony: form.hasBalcony,
      bedrooms: Number(form.bedrooms || 0),
      bathrooms: Number(form.bathrooms || 0),
    };
    const res = await fetch(`/api/admin/properties/${params.id}`, {
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

  async function saveIntegration() {
    setSavingIntegration(true);
    const res = await fetch(`/api/admin/properties/${params.id}/integration`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icalUrl: icalUrl || null, isEnabled: icalEnabled, syncOptions }),
    });
    setSavingIntegration(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Save failed", description: err.error ?? "Could not save integration.", variant: "destructive" });
      return;
    }
    toast({ title: "Integration saved" });
  }

  async function triggerSync() {
    setSyncing(true);
    const res = await fetch(`/api/admin/properties/${params.id}/integration`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSyncing(false);
    if (!res.ok) {
      const err = body;
      toast({ title: "Sync failed", description: err.error ?? "Could not trigger sync.", variant: "destructive" });
      return;
    }
    const summary = body.summary ?? {};
    toast({
      title: "Sync completed",
      description: `${summary.reservationsCreated ?? 0} reservations created, ${summary.jobsCreated ?? 0} jobs created, ${summary.jobsUpdated ?? 0} jobs updated.`,
    });
    loadProperty();
  }

  async function undoSyncRun(runId: string) {
    setUndoingSyncRunId(runId);
    const res = await fetch(`/api/admin/properties/${params.id}/integration/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    const body = await res.json().catch(() => ({}));
    setUndoingSyncRunId(null);
    if (!res.ok) {
      toast({ title: "Undo failed", description: body.error ?? "Could not undo sync run.", variant: "destructive" });
      return;
    }
    toast({
      title: "Sync reverted",
      description: [
        `${body.result?.deletedJobs ?? 0} jobs deleted`,
        `${body.result?.restoredJobs ?? 0} jobs restored`,
        `${body.result?.deletedReservations ?? 0} reservations deleted`,
        `${body.result?.restoredReservations ?? 0} reservations restored`,
        (body.result?.skipped ?? 0) > 0 ? `${body.result.skipped} items skipped` : null,
      ]
        .filter(Boolean)
        .join(", "),
    });
    loadProperty();
  }

  async function saveStockLevels() {
    if (!property) return;
    setSavingStock(true);
    const levels = (stockRows ?? []).map((row: any) => {
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
    const res = await fetch(`/api/admin/inventory/property/${params.id}/set-levels`, {
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
    loadInventoryCatalog();
  }

  async function saveFormOverrides() {
    setSavingFormOverrides(true);
    try {
      const res = await fetch(`/api/admin/properties/${params.id}/form-overrides`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: formTemplateOverrides }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not save form defaults.");
      }
      toast({ title: "Form defaults updated" });
      await loadFormOverrides();
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err.message ?? "Could not save form defaults.",
        variant: "destructive",
      });
    } finally {
      setSavingFormOverrides(false);
    }
  }

  function addItemToProperty(item: any, defaults?: { onHand?: number; parLevel?: number; reorderThreshold?: number }) {
    if (!item?.id) return;
    if (stockRows.some((row: any) => row.itemId === item.id)) {
      toast({ title: "Item already added", description: `${item.name} is already assigned to this property.` });
      return;
    }
    const onHand = defaults?.onHand ?? 0;
    const parLevel = defaults?.parLevel ?? 6;
    const reorderThreshold = defaults?.reorderThreshold ?? 2;
    setStockRows((prev) => [
      ...prev,
      {
        id: `new-${item.id}`,
        propertyId: params.id,
        itemId: item.id,
        onHand,
        parLevel,
        reorderThreshold,
        item,
      },
    ]);
    setStockDraft((prev) => ({
      ...prev,
      [item.id]: {
        onHand: String(onHand),
        parLevel: String(parLevel),
        reorderThreshold: String(reorderThreshold),
      },
    }));
  }

  async function addPresetItem() {
    const item = inventoryItems.find((row: any) => row.id === selectedPresetId);
    if (!item) {
      toast({ title: "Select a preset item first.", variant: "destructive" });
      return;
    }
    setAddingPreset(true);
    try {
      addItemToProperty(item);
      toast({ title: "Preset item added", description: `${item.name} is ready to save for this property.` });
    } finally {
      setAddingPreset(false);
    }
  }

  async function addCustomItem() {
    if (!customItem.name.trim()) {
      toast({ title: "Custom item name is required.", variant: "destructive" });
      return;
    }
    setAddingCustom(true);
    try {
      const res = await fetch("/api/admin/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customItem.name.trim(),
          category: customItem.category.trim() || "Custom",
          location: customItem.location,
          unit: customItem.unit.trim() || "unit",
          supplier: customItem.supplier.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not create custom item.");
      }
      const createdItem = body;
      setInventoryItems((prev) => [...prev, createdItem]);
      addItemToProperty(createdItem, {
        onHand: Number(customItem.onHand || 0),
        parLevel: Number(customItem.parLevel || 6),
        reorderThreshold: Number(customItem.reorderThreshold || 2),
      });
      setCustomItem({
        name: "",
        category: "Custom",
        location: "CLEANERS_CUPBOARD",
        unit: "unit",
        supplier: "",
        onHand: "0",
        parLevel: "6",
        reorderThreshold: "2",
      });
      toast({ title: "Custom item added", description: "Save levels to attach it permanently to this property." });
    } catch (err: any) {
      toast({
        title: "Create failed",
        description: err.message ?? "Could not create custom item.",
        variant: "destructive",
      });
    } finally {
      setAddingCustom(false);
    }
  }

  async function deleteProperty() {
    setDeletingProperty(true);
    const res = await fetch(`/api/admin/properties/${params.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setDeletingProperty(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete property.", variant: "destructive" });
      return;
    }
    toast({ title: "Property deleted" });
    setDeleteOpen(false);
    router.push("/admin/properties");
    router.refresh();
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!property) return <div className="p-8 text-destructive">Property not found.</div>;

  const intg = property.integration;
  const mapsUrl = buildGoogleMapsUrl({
    address: property.address,
    suburb: property.suburb,
    state: property.state,
    postcode: property.postcode,
  });
  const propertyAccess = (property.accessInfo ?? {}) as Record<string, any>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/properties"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">{property.name}</h2>
          <p className="text-sm text-muted-foreground">
            {property.address}, {property.suburb} - Client: {property.client?.name}
          </p>
        </div>
        {mapsUrl ? (
          <Button variant="outline" size="sm" asChild>
            <a href={mapsUrl} target="_blank" rel="noreferrer">
              <MapPinned className="mr-2 h-4 w-4" />
              Open Maps
            </a>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/properties/new?copyFrom=${property.id}`}>
            <Copy className="mr-2 h-4 w-4" />
            Copy Property
          </Link>
        </Button>
        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="forms">Forms</TabsTrigger>
          <TabsTrigger value="integration">
            iCal Integration
            {intg?.syncStatus === "ERROR" && (
              <AlertTriangle className="ml-1 h-3 w-3 text-destructive" />
            )}
          </TabsTrigger>
          <TabsTrigger value="stock">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Suburb", property.suburb || "-"],
              ["Bedrooms", property.bedrooms],
              ["Bathrooms", property.bathrooms],
              ["Balcony", property.hasBalcony ? "Yes" : "No"],
              ["Linen Buffer Sets", property.linenBufferSets],
              [
                "Default Clean Duration",
                typeof propertyAccess.defaultCleanDurationHours === "number"
                  ? `${propertyAccess.defaultCleanDurationHours}h`
                  : "3h",
              ],
              [
                "Maximum Guest Count",
                typeof propertyAccess.maxGuestCount === "number"
                  ? propertyAccess.maxGuestCount
                  : 4,
              ],
              ["Default Check-in", property.defaultCheckinTime],
              ["Default Check-out", property.defaultCheckoutTime],
            ].map(([label, val]) => (
              <Card key={label as string}>
                <CardContent className="pt-4">
                  <p className="text-xs uppercase text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg font-semibold">{val}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          {property.notes && (
            <Card><CardContent className="pt-4"><p className="text-sm">{property.notes}</p></CardContent></Card>
          )}
          {(propertyAccess.lockbox ||
            propertyAccess.codes ||
            propertyAccess.parking ||
            propertyAccess.other ||
            propertyAccess.instructions ||
            (Array.isArray(propertyAccess.attachments) && propertyAccess.attachments.length > 0)) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  Access Instructions
                  {mapsUrl ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={mapsUrl} target="_blank" rel="noreferrer">
                        <MapPinned className="mr-2 h-4 w-4" />
                        Google Maps
                      </a>
                    </Button>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {propertyAccess.lockbox ? (
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Lockbox</p>
                      <p className="text-sm">{propertyAccess.lockbox}</p>
                    </div>
                  ) : null}
                  {propertyAccess.codes ? (
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Codes</p>
                      <p className="text-sm">{propertyAccess.codes}</p>
                    </div>
                  ) : null}
                  {propertyAccess.parking ? (
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Parking / Building Access</p>
                      <p className="text-sm whitespace-pre-wrap">{propertyAccess.parking}</p>
                    </div>
                  ) : null}
                  {propertyAccess.other ? (
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Other Notes</p>
                      <p className="text-sm whitespace-pre-wrap">{propertyAccess.other}</p>
                    </div>
                  ) : null}
                </div>
                {propertyAccess.instructions ? (
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Step-by-Step Entry</p>
                    <p className="text-sm whitespace-pre-wrap">{propertyAccess.instructions}</p>
                  </div>
                ) : null}
                {Array.isArray(propertyAccess.attachments) && propertyAccess.attachments.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {propertyAccess.attachments
                      .filter((item: any) => item?.url)
                      .map((item: any, index: number) => {
                        const isImage = typeof item.contentType === "string" && item.contentType.startsWith("image/");
                        return (
                          <div key={`${item.url}-${index}`} className="rounded-md border p-3">
                            {isImage ? (
                              <img
                                src={item.url}
                                alt={item.name ?? "Access file"}
                                className="mb-3 h-32 w-full rounded object-cover"
                              />
                            ) : null}
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-medium text-primary hover:underline"
                            >
                              {item.name ?? "Open file"}
                            </a>
                          </div>
                        );
                      })}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="edit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Edit Property Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Suburb</Label>
                  <Input value={form.suburb} onChange={(e) => setForm((prev) => ({ ...prev, suburb: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Address</Label>
                  <GoogleAddressInput
                    value={form.address}
                    placeholder="Start typing and select an address"
                    onChange={(value) => setForm((prev) => ({ ...prev, address: value }))}
                    onResolved={(parts) =>
                      setForm((prev) => ({
                        ...prev,
                        address: parts.address || prev.address,
                        suburb: parts.suburb || prev.suburb,
                        state: parts.state || prev.state,
                        postcode: parts.postcode || prev.postcode,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Postcode</Label>
                  <Input value={form.postcode} onChange={(e) => setForm((prev) => ({ ...prev, postcode: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Bedrooms</Label>
                  <Input type="number" min="0" value={form.bedrooms} onChange={(e) => setForm((prev) => ({ ...prev, bedrooms: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Bathrooms</Label>
                  <Input type="number" min="0" value={form.bathrooms} onChange={(e) => setForm((prev) => ({ ...prev, bathrooms: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Linen buffer sets</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.linenBufferSets}
                    onChange={(e) => setForm((prev) => ({ ...prev, linenBufferSets: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Default clean duration (hours)</Label>
                  <Input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={form.defaultCleanDurationHours}
                    onChange={(e) => setForm((prev) => ({ ...prev, defaultCleanDurationHours: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Maximum guest count</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={form.maxGuestCount}
                    onChange={(e) => setForm((prev) => ({ ...prev, maxGuestCount: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Default check-in</Label>
                  <Input type="time" value={form.defaultCheckinTime} onChange={(e) => setForm((prev) => ({ ...prev, defaultCheckinTime: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Default check-out</Label>
                  <Input type="time" value={form.defaultCheckoutTime} onChange={(e) => setForm((prev) => ({ ...prev, defaultCheckoutTime: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-md border p-3">
                  <Switch
                    checked={form.inventoryEnabled}
                    onCheckedChange={(value) => setForm((prev) => ({ ...prev, inventoryEnabled: value }))}
                  />
                  <span className="text-sm">Inventory enabled</span>
                </label>
                <label className="flex items-center gap-3 rounded-md border p-3">
                  <Switch
                    checked={form.hasBalcony}
                    onCheckedChange={(value) => setForm((prev) => ({ ...prev, hasBalcony: value }))}
                  />
                  <span className="text-sm">Has balcony</span>
                </label>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
              </div>
              <PropertyAccessFields
                value={accessInfo}
                onChange={setAccessInfo}
                addressParts={{
                  address: form.address,
                  suburb: form.suburb,
                  state: form.state,
                  postcode: form.postcode,
                }}
              />
              <div className="flex justify-end">
                <Button onClick={saveProperty} disabled={savingProperty}>
                  <Save className="mr-2 h-4 w-4" />
                  {savingProperty ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <PropertyClientRateEditor propertyId={String(params.id)} />
        </TabsContent>

        <TabsContent value="forms">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Property Form Defaults</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Set a default form template for each job type at this property. Leave on global to use the latest active template.
                </p>
              </div>
              <Button onClick={saveFormOverrides} disabled={savingFormOverrides || loadingFormOverrides}>
                {savingFormOverrides ? "Saving..." : "Save defaults"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingFormOverrides ? (
                <p className="text-sm text-muted-foreground">Loading template defaults...</p>
              ) : (
                <div className="space-y-3">
                  {formTemplateJobTypes.map((jobType) => {
                    const options = formTemplateOptionsByJobType[jobType] ?? [];
                    const selectedValue = formTemplateOverrides[jobType] ?? "__global__";
                    const globalId = formTemplateGlobalDefaults[jobType];
                    const globalTemplate = options.find((option) => option.id === globalId);

                    return (
                      <div
                        key={jobType}
                        className="grid gap-2 rounded-md border p-3 md:grid-cols-[230px,1fr]"
                      >
                        <div>
                          <p className="text-sm font-medium">{jobTypeLabel(jobType)}</p>
                          <p className="text-xs text-muted-foreground">
                            {globalTemplate
                              ? `Global default: ${globalTemplate.name} (v${globalTemplate.version})`
                              : "Global default: none available"}
                          </p>
                        </div>
                        <select
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          value={selectedValue}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            setFormTemplateOverrides((prev) => {
                              const next = { ...prev };
                              if (nextValue === "__global__") {
                                delete next[jobType];
                              } else {
                                next[jobType] = nextValue;
                              }
                              return next;
                            });
                          }}
                        >
                          <option value="__global__">Use global latest active template</option>
                          {options.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name} (v{option.version})
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                Hospitable iCal Feed
                <div className="flex items-center gap-2">
                  {intg?.syncStatus === "SUCCESS" && <Badge variant="success"><CheckCircle className="mr-1 h-3 w-3" />Synced</Badge>}
                  {intg?.syncStatus === "ERROR" && <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Error</Badge>}
                  {intg?.syncStatus === "SYNCING" && <Badge><RefreshCw className="mr-1 h-3 w-3 animate-spin" />Syncing</Badge>}
                  {intg?.lastSyncAt && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(intg.lastSyncAt), "dd MMM HH:mm")}
                    </span>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Hospitable iCal is <strong>read-only</strong>. Manual blocks inside Hospitable do not appear in this feed.
                  Refresh interval is approximately 40 minutes. Use "Sync now" for immediate refresh.
                </span>
              </div>

              <div className="space-y-3">
                <div>
                  <Label>iCal URL (leave blank to disable sync)</Label>
                  <Input
                    value={icalUrl}
                    onChange={(e) => setIcalUrl(e.target.value)}
                    placeholder="https://app.hospitable.com/api/ical/..."
                    className="mt-1 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="ical-enabled"
                    checked={icalEnabled}
                    onCheckedChange={setIcalEnabled}
                    disabled={!icalUrl}
                  />
                  <Label htmlFor="ical-enabled">Enable automatic sync</Label>
                </div>
                  <div className="grid gap-3 rounded-md border p-3 md:grid-cols-2">
                    <label className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">Ignore past dates when syncing</p>
                        <p className="text-xs text-muted-foreground">Only import current and future stays from the iCal feed.</p>
                      </div>
                      <Switch
                        checked={syncOptions.ignorePastDates}
                        onCheckedChange={(value) =>
                          setSyncOptions((prev) => ({ ...prev, ignorePastDates: value }))
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">Auto-create turnover jobs</p>
                        <p className="text-xs text-muted-foreground">Create Airbnb turnover jobs from synced reservations.</p>
                      </div>
                    <Switch
                      checked={syncOptions.autoCreateTurnoverJobs}
                      onCheckedChange={(value) =>
                        setSyncOptions((prev) => ({ ...prev, autoCreateTurnoverJobs: value }))
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">Update linked jobs on re-sync</p>
                      <p className="text-xs text-muted-foreground">Keep reservation-linked jobs aligned with the latest feed dates.</p>
                    </div>
                    <Switch
                      checked={syncOptions.updateExistingLinkedJobs}
                      onCheckedChange={(value) =>
                        setSyncOptions((prev) => ({ ...prev, updateExistingLinkedJobs: value }))
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">Verify duplicate feed events</p>
                      <p className="text-xs text-muted-foreground">Ignore repeated reservation UIDs in the incoming iCal feed.</p>
                    </div>
                    <Switch
                      checked={syncOptions.verifyFeedDuplicates}
                      onCheckedChange={(value) =>
                        setSyncOptions((prev) => ({ ...prev, verifyFeedDuplicates: value }))
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">Verify duplicate job conflicts</p>
                      <p className="text-xs text-muted-foreground">Skip creating a turnover job if one already exists on the same property/date.</p>
                    </div>
                    <Switch
                      checked={syncOptions.verifyExistingJobConflicts}
                      onCheckedChange={(value) =>
                        setSyncOptions((prev) => ({ ...prev, verifyExistingJobConflicts: value }))
                      }
                    />
                  </label>
                </div>
              </div>

              {intg?.syncError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <strong>Last error:</strong> {intg.syncError}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={saveIntegration} disabled={savingIntegration}>
                  {savingIntegration ? "Saving..." : "Save settings"}
                </Button>
                <Button variant="outline" onClick={triggerSync} disabled={syncing || !icalUrl}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                  Sync now
                </Button>
              </div>

              <div className="space-y-3 rounded-md border p-4">
                <div>
                  <p className="text-sm font-medium">Recent Sync Runs</p>
                  <p className="text-xs text-muted-foreground">
                    Review what changed, spot duplicate warnings, and undo a specific successful sync.
                  </p>
                </div>
                {Array.isArray(intg?.syncRuns) && intg.syncRuns.length > 0 ? (
                  <div className="space-y-3">
                    {intg.syncRuns.map((run: any) => {
                      const runSummary = run.summary ?? {};
                      const warnings = Array.isArray(runSummary.warnings) ? runSummary.warnings : [];
                      const changedCount =
                        (runSummary.reservationsCreated ?? 0) +
                        (runSummary.reservationsUpdated ?? 0) +
                        (runSummary.jobsCreated ?? 0) +
                        (runSummary.jobsUpdated ?? 0);
                      const canUndo = run.status === "SUCCESS" && !run.revertedAt && changedCount > 0;
                      return (
                        <div key={run.id} className="rounded-md border p-3">
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={run.status === "SUCCESS" ? "success" : run.status === "REVERTED" ? "secondary" : run.status === "ERROR" ? "destructive" : "outline"}>
                                  {run.status}
                                </Badge>
                                <span className="text-sm font-medium">{run.mode}</span>
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(run.createdAt), "dd MMM yyyy HH:mm")}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                By {run.triggeredBy?.name || run.triggeredBy?.email || "System"}
                                {run.revertedAt ? ` • Reverted ${format(new Date(run.revertedAt), "dd MMM HH:mm")}` : ""}
                              </p>
                            </div>
                            {canUndo ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => undoSyncRun(run.id)}
                                disabled={undoingSyncRunId === run.id}
                              >
                                {undoingSyncRunId === run.id ? "Undoing..." : "Undo sync"}
                              </Button>
                            ) : null}
                          </div>
                          <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-4">
                            <span>Reservations: +{runSummary.reservationsCreated ?? 0} / updated {runSummary.reservationsUpdated ?? 0}</span>
                            <span>Jobs: +{runSummary.jobsCreated ?? 0} / updated {runSummary.jobsUpdated ?? 0}</span>
                            <span>Feed duplicates: {runSummary.duplicateFeedEvents ?? 0}</span>
                            <span>Job conflicts skipped: {runSummary.jobsSkippedConflict ?? 0}</span>
                          </div>
                          {warnings.length > 0 ? (
                            <div className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
                              {warnings.map((warning: string, index: number) => (
                                <p key={`${run.id}-warning-${index}`}>{warning}</p>
                              ))}
                            </div>
                          ) : null}
                          {run.status === "SUCCESS" && !run.revertedAt && changedCount === 0 ? (
                            <div className="mt-3 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                              This sync run did not change any reservations or jobs, so there is nothing to undo.
                            </div>
                          ) : null}
                          {run.error ? (
                            <div className="mt-3 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                              {run.error}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No sync runs recorded yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stock">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Property Inventory</CardTitle>
              <Button onClick={saveStockLevels} disabled={savingStock || !property.inventoryEnabled}>
                {savingStock ? "Saving..." : "Save levels"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              {!property.inventoryEnabled ? (
                <p className="text-sm text-muted-foreground">Inventory tracking is disabled for this property.</p>
              ) : (
                <>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-3 rounded-md border p-4">
                      <div>
                        <p className="text-sm font-medium">Add preset inventory item</p>
                        <p className="text-xs text-muted-foreground">
                          Add standard Airbnb inventory items to this property.
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          value={selectedPresetId}
                          onChange={(e) => setSelectedPresetId(e.target.value)}
                        >
                          <option value="">Select preset item</option>
                          {defaultInventoryItems
                            .filter((item: any) => !stockRows.some((row: any) => row.itemId === item.id))
                            .map((item: any) => (
                              <option key={item.id} value={item.id}>
                                {item.name} ({INVENTORY_LOCATION_LABELS[item.location as InventoryLocation] ?? item.location} - {item.category})
                              </option>
                            ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={addPresetItem}
                          disabled={addingPreset || !selectedPresetId}
                        >
                          {addingPreset ? "Adding..." : "Add preset"}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-md border p-4">
                      <div>
                        <p className="text-sm font-medium">Add custom inventory item</p>
                        <p className="text-xs text-muted-foreground">
                          Create a new item and attach it to this property with opening stock levels.
                        </p>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <Input
                          placeholder="Item name"
                          value={customItem.name}
                          onChange={(e) => setCustomItem((prev) => ({ ...prev, name: e.target.value }))}
                        />
                        <Input
                          placeholder="Category"
                          value={customItem.category}
                          onChange={(e) => setCustomItem((prev) => ({ ...prev, category: e.target.value }))}
                        />
                        <select
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          value={customItem.location}
                          onChange={(e) =>
                            setCustomItem((prev) => ({
                              ...prev,
                              location: e.target.value as InventoryLocation,
                            }))
                          }
                        >
                          {INVENTORY_LOCATIONS.map((location) => (
                            <option key={location} value={location}>
                              {INVENTORY_LOCATION_LABELS[location]}
                            </option>
                          ))}
                        </select>
                        <Input
                          placeholder="Unit"
                          value={customItem.unit}
                          onChange={(e) => setCustomItem((prev) => ({ ...prev, unit: e.target.value }))}
                        />
                        <Input
                          placeholder="Supplier"
                          value={customItem.supplier}
                          onChange={(e) => setCustomItem((prev) => ({ ...prev, supplier: e.target.value }))}
                        />
                        <Input
                          type="number"
                          min="0"
                          placeholder="On hand"
                          value={customItem.onHand}
                          onChange={(e) => setCustomItem((prev) => ({ ...prev, onHand: e.target.value }))}
                        />
                        <Input
                          type="number"
                          min="0"
                          placeholder="Par level"
                          value={customItem.parLevel}
                          onChange={(e) => setCustomItem((prev) => ({ ...prev, parLevel: e.target.value }))}
                        />
                        <Input
                          type="number"
                          min="0"
                          placeholder="Reorder threshold"
                          value={customItem.reorderThreshold}
                          onChange={(e) => setCustomItem((prev) => ({ ...prev, reorderThreshold: e.target.value }))}
                        />
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" variant="outline" onClick={addCustomItem} disabled={addingCustom}>
                          {addingCustom ? "Adding..." : "Add custom item"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {stockRows.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b">
                          <tr className="text-xs text-muted-foreground">
                            <th className="p-3 text-left">Item</th>
                            <th className="p-3 text-left">Location</th>
                            <th className="p-3 text-left">Category</th>
                            <th className="p-3 text-right">On hand</th>
                            <th className="p-3 text-right">Par</th>
                            <th className="p-3 text-right">Threshold</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {stockRows.map((stock: any) => {
                            const draft = stockDraft[stock.itemId] ?? {
                              onHand: String(stock.onHand ?? 0),
                              parLevel: String(stock.parLevel ?? 0),
                              reorderThreshold: String(stock.reorderThreshold ?? 0),
                            };
                            return (
                              <tr key={stock.id}>
                                <td className="p-3 font-medium">{stock.item.name}</td>
                                <td className="p-3 text-muted-foreground">
                                  {INVENTORY_LOCATION_LABELS[
                                    (stock.item.location as InventoryLocation) ?? "CLEANERS_CUPBOARD"
                                  ] ?? stock.item.location ?? "Cleaners Cupboard"}
                                </td>
                                <td className="p-3 text-muted-foreground">{stock.item.category}</td>
                                <td className="p-3 text-right">
                                  <Input
                                    className="ml-auto w-24 text-right"
                                    type="number"
                                    min="0"
                                    value={draft.onHand}
                                    onChange={(e) =>
                                      setStockDraft((prev) => ({ ...prev, [stock.itemId]: { ...draft, onHand: e.target.value } }))
                                    }
                                  />
                                </td>
                                <td className="p-3 text-right">
                                  <Input
                                    className="ml-auto w-24 text-right"
                                    type="number"
                                    min="0"
                                    value={draft.parLevel}
                                    onChange={(e) =>
                                      setStockDraft((prev) => ({ ...prev, [stock.itemId]: { ...draft, parLevel: e.target.value } }))
                                    }
                                  />
                                </td>
                                <td className="p-3 text-right">
                                  <Input
                                    className="ml-auto w-24 text-right"
                                    type="number"
                                    min="0"
                                    value={draft.reorderThreshold}
                                    onChange={(e) =>
                                      setStockDraft((prev) => ({ ...prev, [stock.itemId]: { ...draft, reorderThreshold: e.target.value } }))
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No inventory rows yet. Add preset or custom items above, then save levels.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <TwoStepConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete property"
        description="This will deactivate the property and remove it from active operations lists."
        confirmLabel="Delete property"
        loading={deletingProperty}
        onConfirm={deleteProperty}
      />
    </div>
  );
}
