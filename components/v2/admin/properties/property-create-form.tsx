"use client";

/**
 * ESTATE create-property form — v2-native replacement for the v1 onboarding
 * form (components/admin/new-property-form.tsx). Same POST /api/admin/properties
 * payload and same load endpoints (clients, inventory defaults, laundry users).
 * Styled purely through the Estate token scope; no dependency on components/ui/*.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  INVENTORY_LOCATIONS,
  INVENTORY_LOCATION_LABELS,
  type InventoryLocation,
} from "@/lib/inventory/locations";
import { EButton, ECard, ECardBody, ECardHeader, ECardTitle, EEyebrow, EPageHeader } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";
import {
  PropertySetupGuideEditor,
  LaundryBagColorPicker,
  type SetupGuideEntry,
} from "./property-setup-guide-editor";

interface ClientOption {
  id: string;
  name: string;
}

interface InventoryOption {
  id: string;
  name: string;
  category: string;
  location: InventoryLocation;
  unit: string;
}

type LaundryUser = { id: string; name: string; email: string };

type CustomItem = {
  name: string;
  category: string;
  location: InventoryLocation;
  unit: string;
  supplier: string;
  onHand: string;
  parLevel: string;
  reorderThreshold: string;
};

export function PropertyCreateForm({
  initialClientId,
  copyFromPropertyId,
}: {
  initialClientId?: string;
  copyFromPropertyId?: string;
}) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [defaultInventoryItems, setDefaultInventoryItems] = useState<InventoryOption[]>([]);
  const [selectedDefaultItemIds, setSelectedDefaultItemIds] = useState<string[]>([]);
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [laundryUsers, setLaundryUsers] = useState<LaundryUser[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copySourceName, setCopySourceName] = useState<string | null>(null);

  const [access, setAccess] = useState({
    lockbox: "",
    codes: "",
    parking: "",
    other: "",
    instructions: "",
    laundryTeamUserIds: [] as string[],
  });

  const [form, setForm] = useState({
    clientId: initialClientId ?? "",
    name: "",
    address: "",
    suburb: "",
    state: "NSW",
    postcode: "",
    latitude: null as number | null,
    longitude: null as number | null,
    placeId: null as string | null,
    notes: "",
    linenBufferSets: "0",
    defaultCleanDurationHours: "3",
    maxGuestCount: "4",
    inventoryEnabled: false,
    laundryEnabled: true,
    defaultCheckinTime: "14:00",
    defaultCheckoutTime: "10:00",
    hasBalcony: false,
    bedrooms: "1",
    bathrooms: "1",
    cleaningDurationMinutes: "",
    cleanerServiceRate: "",
    laundryBagLabel: "",
    laundryBagColor: "",
    sofaBedCount: "0",
  });

  const [setupGuide, setSetupGuide] = useState<SetupGuideEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        fetch("/api/admin/users?role=LAUNDRY")
          .then((r) => (r.ok ? r.json() : []))
          .then((rows) => {
            if (cancelled) return;
            setLaundryUsers(
              Array.isArray(rows)
                ? rows
                    .filter((row: any) => row?.id)
                    .map((row: any) => ({
                      id: String(row.id),
                      name: String(row.name ?? row.email ?? row.id),
                      email: String(row.email ?? ""),
                    }))
                : [],
            );
          })
          .catch(() => setLaundryUsers([]));

        const requests: Promise<any>[] = [
          fetch("/api/admin/clients").then((r) => r.json()),
          fetch("/api/admin/inventory/defaults").then((r) => r.json()),
        ];
        if (copyFromPropertyId) {
          requests.push(fetch(`/api/admin/properties/${copyFromPropertyId}`).then((r) => r.json()));
        }
        const [clientData, inventoryData, copySource] = await Promise.all(requests);
        if (cancelled) return;

        setClients(Array.isArray(clientData) ? clientData.map((c: any) => ({ id: c.id, name: c.name })) : []);

        const defaults: InventoryOption[] = Array.isArray(inventoryData)
          ? inventoryData.map((i: any) => ({
              id: i.id,
              name: i.name,
              category: i.category,
              location: i.location ?? "CLEANERS_CUPBOARD",
              unit: i.unit,
            }))
          : [];
        setDefaultInventoryItems(defaults);
        setSelectedDefaultItemIds(defaults.map((item) => item.id));

        if (copyFromPropertyId && copySource && !copySource.error) {
          setCopySourceName(copySource.name ?? null);
          const acc = (copySource.accessInfo ?? {}) as Record<string, any>;
          setAccess({
            lockbox: typeof acc.lockbox === "string" ? acc.lockbox : "",
            codes: typeof acc.codes === "string" ? acc.codes : "",
            parking: typeof acc.parking === "string" ? acc.parking : "",
            other: typeof acc.other === "string" ? acc.other : "",
            instructions: typeof acc.instructions === "string" ? acc.instructions : "",
            laundryTeamUserIds: Array.isArray(acc.laundryTeamUserIds)
              ? acc.laundryTeamUserIds.filter((v: unknown): v is string => typeof v === "string")
              : [],
          });
          setForm((prev) => ({
            ...prev,
            clientId: copySource.clientId ?? prev.clientId,
            name: copySource.name ? `${copySource.name} (Copy)` : prev.name,
            address: copySource.address ?? "",
            suburb: copySource.suburb ?? "",
            state: copySource.state ?? "NSW",
            postcode: copySource.postcode ?? "",
            latitude: typeof copySource.latitude === "number" ? copySource.latitude : null,
            longitude: typeof copySource.longitude === "number" ? copySource.longitude : null,
            placeId: typeof copySource.placeId === "string" ? copySource.placeId : null,
            notes: copySource.notes ?? "",
            linenBufferSets: String(copySource.linenBufferSets ?? 0),
            defaultCleanDurationHours:
              typeof acc.defaultCleanDurationHours === "number" ? String(acc.defaultCleanDurationHours) : "3",
            maxGuestCount: typeof acc.maxGuestCount === "number" ? String(acc.maxGuestCount) : "4",
            inventoryEnabled: Boolean(copySource.inventoryEnabled),
            laundryEnabled: copySource.laundryEnabled !== false,
            defaultCheckinTime: copySource.defaultCheckinTime ?? "14:00",
            defaultCheckoutTime: copySource.defaultCheckoutTime ?? "10:00",
            hasBalcony: Boolean(copySource.hasBalcony),
            bedrooms: String(copySource.bedrooms ?? 1),
            bathrooms: String(copySource.bathrooms ?? 1),
            cleaningDurationMinutes:
              typeof copySource.cleaningDurationMinutes === "number"
                ? String(copySource.cleaningDurationMinutes)
                : "",
            cleanerServiceRate:
              typeof copySource.cleanerServiceRate === "number"
                ? String(copySource.cleanerServiceRate)
                : "",
            laundryBagLabel: typeof copySource.laundryBagLabel === "string" ? copySource.laundryBagLabel : "",
            laundryBagColor: typeof copySource.laundryBagColor === "string" ? copySource.laundryBagColor : "",
            sofaBedCount: String(copySource.sofaBedCount ?? 0),
          }));
          setSetupGuide(Array.isArray(copySource.setupGuide) ? copySource.setupGuide : []);

          const defaultIdSet = new Set(defaults.map((item) => item.id));
          const stockRows = Array.isArray(copySource.propertyStock) ? copySource.propertyStock : [];
          setSelectedDefaultItemIds(
            stockRows.filter((row: any) => defaultIdSet.has(row.itemId)).map((row: any) => row.itemId),
          );
          setCustomItems(
            stockRows
              .filter((row: any) => !defaultIdSet.has(row.itemId))
              .map((row: any) => ({
                name: row.item?.name ?? "",
                category: row.item?.category ?? "Custom",
                location: row.item?.location ?? "CLEANERS_CUPBOARD",
                unit: row.item?.unit ?? "unit",
                supplier: row.item?.supplier ?? "",
                onHand: String(row.onHand ?? 0),
                parLevel: String(row.parLevel ?? 6),
                reorderThreshold: String(row.reorderThreshold ?? 2),
              })),
          );
        }
      } finally {
        if (!cancelled) setLoadingClients(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [copyFromPropertyId]);

  function setF<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleLaundryMember(id: string) {
    setAccess((prev) => ({
      ...prev,
      laundryTeamUserIds: prev.laundryTeamUserIds.includes(id)
        ? prev.laundryTeamUserIds.filter((x) => x !== id)
        : [...prev.laundryTeamUserIds, id],
    }));
  }

  async function createProperty() {
    if (!form.clientId || !form.name.trim() || !form.address.trim() || !form.suburb.trim()) {
      toast({ title: "Client, name, address, and suburb are required.", variant: "destructive" });
      return;
    }

    const laundryTeamUserIds = form.laundryEnabled ? access.laundryTeamUserIds.filter(Boolean) : [];
    if (form.laundryEnabled && laundryTeamUserIds.length === 0) {
      toast({
        title: "Assign a laundry team",
        description:
          "Laundry service is on — choose at least one laundry team member, or turn Laundry Service off.",
        variant: "destructive",
      });
      return;
    }

    const hasAccess =
      Number(form.defaultCleanDurationHours) > 0 ||
      Number(form.maxGuestCount) > 0 ||
      access.lockbox ||
      access.codes ||
      access.parking ||
      access.other ||
      access.instructions ||
      laundryTeamUserIds.length > 0;

    const accessPayload = hasAccess
      ? {
          ...(Number(form.defaultCleanDurationHours) > 0
            ? { defaultCleanDurationHours: Number(form.defaultCleanDurationHours) }
            : {}),
          ...(Number(form.maxGuestCount) > 0 ? { maxGuestCount: Number(form.maxGuestCount) } : {}),
          lockbox: access.lockbox || undefined,
          codes: access.codes || undefined,
          parking: access.parking || undefined,
          other: access.other || undefined,
          instructions: access.instructions || undefined,
          laundryTeamUserIds: laundryTeamUserIds.length > 0 ? laundryTeamUserIds : undefined,
        }
      : undefined;

    const payload = {
      clientId: form.clientId,
      name: form.name,
      address: form.address,
      suburb: form.suburb,
      state: form.state || "NSW",
      postcode: form.postcode || undefined,
      latitude: form.latitude ?? undefined,
      longitude: form.longitude ?? undefined,
      placeId: form.placeId ?? undefined,
      notes: form.notes || undefined,
      accessInfo: accessPayload,
      linenBufferSets: Number(form.linenBufferSets) || 0,
      inventoryEnabled: form.inventoryEnabled,
      laundryEnabled: form.laundryEnabled,
      defaultCheckinTime: form.defaultCheckinTime,
      defaultCheckoutTime: form.defaultCheckoutTime,
      hasBalcony: form.hasBalcony,
      bedrooms: Number(form.bedrooms) || 0,
      bathrooms: Number(form.bathrooms) || 0,
      cleaningDurationMinutes:
        form.cleaningDurationMinutes.trim() !== "" ? Number(form.cleaningDurationMinutes) : null,
      cleanerServiceRate:
        form.cleanerServiceRate.trim() !== "" ? Number(form.cleanerServiceRate) : null,
      laundryBagLabel: form.laundryBagLabel.trim() || null,
      laundryBagColor: form.laundryBagColor || null,
      sofaBedCount: Number(form.sofaBedCount) || 0,
      setupGuide,
      defaultInventoryItemIds: form.inventoryEnabled ? selectedDefaultItemIds : [],
      customInventoryItems: form.inventoryEnabled
        ? customItems
            .filter((item) => item.name.trim())
            .map((item) => ({
              name: item.name.trim(),
              category: item.category.trim() || "Custom",
              location: item.location,
              unit: item.unit.trim() || "unit",
              supplier: item.supplier.trim() || undefined,
              onHand: Number(item.onHand) || 0,
              parLevel: Number(item.parLevel) || 6,
              reorderThreshold: Number(item.reorderThreshold) || 2,
            }))
        : [],
    };

    setSaving(true);
    try {
      const res = await fetch("/api/admin/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create property.");
      toast({ title: "Property created" });
      router.push(`/v2/admin/properties/${body.id}`);
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Create failed",
        description: err.message ?? "Failed to create property.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

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
        eyebrow={copySourceName ? "Copy property" : "Onboarding"}
        title={copySourceName ? "Copy property" : "Add property"}
        description={
          copySourceName
            ? `Create a new property using "${copySourceName}" as the template.`
            : "Create a property under a client account."
        }
      />

      {/* Property details */}
      <ECard>
        <ECardHeader className="pb-2">
          <ECardTitle className="text-[0.95rem]">Property details</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          <EField label="Client">
            <ESelect
              value={form.clientId}
              onChange={(e) => setF("clientId", e.target.value)}
              disabled={loadingClients}
            >
              <option value="">{loadingClients ? "Loading clients…" : "Select a client"}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </ESelect>
          </EField>

          <div className="grid gap-4 md:grid-cols-2">
            <EField label="Property name">
              <EInput value={form.name} onChange={(e) => setF("name", e.target.value)} />
            </EField>
            <EField label="Suburb">
              <EInput value={form.suburb} onChange={(e) => setF("suburb", e.target.value)} />
            </EField>
          </div>

          <EField label="Address">
            <EAddressInput
              value={form.address}
              placeholder="Start typing an address…"
              onChange={(text) => setF("address", text)}
              onSelect={(r) =>
                setForm((prev) => ({
                  ...prev,
                  address: r.formattedAddress,
                  suburb: r.suburb ?? prev.suburb,
                  state: r.state ?? prev.state,
                  postcode: r.postcode ?? prev.postcode,
                  latitude: r.lat,
                  longitude: r.lng,
                  placeId: r.placeId,
                }))
              }
            />
          </EField>

          <div className="grid gap-4 md:grid-cols-3">
            <EField label="State">
              <EInput
                maxLength={3}
                value={form.state}
                onChange={(e) => setF("state", e.target.value.toUpperCase())}
              />
            </EField>
            <EField label="Postcode">
              <EInput
                inputMode="numeric"
                maxLength={4}
                value={form.postcode}
                onChange={(e) => setF("postcode", e.target.value)}
              />
            </EField>
            <EField label="Linen buffer sets">
              <EInput
                type="number"
                min="0"
                value={form.linenBufferSets}
                onChange={(e) => setF("linenBufferSets", e.target.value)}
              />
            </EField>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <EField label="Bedrooms">
              <EInput type="number" min="0" value={form.bedrooms} onChange={(e) => setF("bedrooms", e.target.value)} />
            </EField>
            <EField label="Bathrooms">
              <EInput type="number" min="0" value={form.bathrooms} onChange={(e) => setF("bathrooms", e.target.value)} />
            </EField>
            <EField label="Clean duration (hrs)">
              <EInput
                type="number"
                min="0.25"
                step="0.25"
                value={form.defaultCleanDurationHours}
                onChange={(e) => setF("defaultCleanDurationHours", e.target.value)}
              />
            </EField>
            <EField label="Max guests">
              <EInput
                type="number"
                min="1"
                max="100"
                value={form.maxGuestCount}
                onChange={(e) => setF("maxGuestCount", e.target.value)}
              />
            </EField>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <EField label="Default check-in time">
              <EInput
                type="time"
                value={form.defaultCheckinTime}
                onChange={(e) => setF("defaultCheckinTime", e.target.value)}
              />
            </EField>
            <EField label="Default checkout time">
              <EInput
                type="time"
                value={form.defaultCheckoutTime}
                onChange={(e) => setF("defaultCheckoutTime", e.target.value)}
              />
            </EField>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <ToggleTile
              title="Has balcony"
              hint="Enable balcony checklist fields."
              checked={form.hasBalcony}
              onChange={(v) => setF("hasBalcony", v)}
            />
            <ToggleTile
              title="Inventory enabled"
              hint="Track stock for this property."
              checked={form.inventoryEnabled}
              onChange={(v) => setF("inventoryEnabled", v)}
            />
            <ToggleTile
              title="Laundry service enabled"
              hint="Disable to exclude from laundry scheduling."
              checked={form.laundryEnabled}
              onChange={(v) => setF("laundryEnabled", v)}
            />
          </div>
        </ECardBody>
      </ECard>

      {/* Inventory */}
      {form.inventoryEnabled ? (
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="text-[0.95rem]">Inventory</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[0.8125rem] font-[550]">Default Airbnb inventory items</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                  Turn items on/off for this property at creation.
                </p>
              </div>
              <EButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedDefaultItemIds(defaultInventoryItems.map((i) => i.id))}
              >
                Select all
              </EButton>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {defaultInventoryItems.map((item) => {
                const checked = selectedDefaultItemIds.includes(item.id);
                return (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedDefaultItemIds((prev) =>
                          e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                        )
                      }
                      className="accent-[hsl(var(--e-primary))]"
                    />
                    <span>
                      {item.name}{" "}
                      <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                        ({INVENTORY_LOCATION_LABELS[item.location]} · {item.category})
                      </span>
                    </span>
                  </label>
                );
              })}
              {defaultInventoryItems.length === 0 ? (
                <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">No default items configured.</p>
              ) : null}
            </div>

            <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <div className="flex items-center justify-between">
                <p className="text-[0.8125rem] font-[550]">Custom items for this property</p>
                <EButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCustomItems((prev) => [
                      ...prev,
                      {
                        name: "",
                        category: "Custom",
                        location: "CLEANERS_CUPBOARD",
                        unit: "unit",
                        supplier: "",
                        onHand: "0",
                        parLevel: "6",
                        reorderThreshold: "2",
                      },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add custom item
                </EButton>
              </div>

              {customItems.length === 0 ? (
                <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">No custom items added yet.</p>
              ) : null}

              <div className="space-y-3">
                {customItems.map((item, index) => (
                  <div
                    key={index}
                    className="grid gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 md:grid-cols-2 lg:grid-cols-4"
                  >
                    <EInput
                      placeholder="Item name"
                      value={item.name}
                      onChange={(e) =>
                        setCustomItems((prev) => prev.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))
                      }
                    />
                    <EInput
                      placeholder="Category"
                      value={item.category}
                      onChange={(e) =>
                        setCustomItems((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, category: e.target.value } : r)),
                        )
                      }
                    />
                    <ESelect
                      value={item.location}
                      onChange={(e) =>
                        setCustomItems((prev) =>
                          prev.map((r, i) =>
                            i === index ? { ...r, location: e.target.value as InventoryLocation } : r,
                          ),
                        )
                      }
                    >
                      {INVENTORY_LOCATIONS.map((location) => (
                        <option key={location} value={location}>
                          {INVENTORY_LOCATION_LABELS[location]}
                        </option>
                      ))}
                    </ESelect>
                    <EInput
                      placeholder="Unit"
                      value={item.unit}
                      onChange={(e) =>
                        setCustomItems((prev) => prev.map((r, i) => (i === index ? { ...r, unit: e.target.value } : r)))
                      }
                    />
                    <EInput
                      placeholder="Supplier"
                      value={item.supplier}
                      onChange={(e) =>
                        setCustomItems((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, supplier: e.target.value } : r)),
                        )
                      }
                    />
                    <EInput
                      type="number"
                      min="0"
                      placeholder="On hand"
                      value={item.onHand}
                      onChange={(e) =>
                        setCustomItems((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, onHand: e.target.value } : r)),
                        )
                      }
                    />
                    <EInput
                      type="number"
                      min="0"
                      placeholder="Par level"
                      value={item.parLevel}
                      onChange={(e) =>
                        setCustomItems((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, parLevel: e.target.value } : r)),
                        )
                      }
                    />
                    <div className="flex gap-2">
                      <EInput
                        type="number"
                        min="0"
                        placeholder="Reorder threshold"
                        value={item.reorderThreshold}
                        onChange={(e) =>
                          setCustomItems((prev) =>
                            prev.map((r, i) => (i === index ? { ...r, reorderThreshold: e.target.value } : r)),
                          )
                        }
                      />
                      <EButton
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove custom item"
                        onClick={() => setCustomItems((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </EButton>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Access & laundry team */}
      <ECard>
        <ECardHeader className="pb-2">
          <ECardTitle className="text-[0.95rem]">Access & instructions</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
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
            <ETextarea
              value={access.instructions}
              onChange={(e) => setAccess((p) => ({ ...p, instructions: e.target.value }))}
            />
          </EField>

          {form.laundryEnabled ? (
            <div className="space-y-2">
              <EEyebrow>Laundry team</EEyebrow>
              {laundryUsers.length === 0 ? (
                <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                  No laundry users found. Turn Laundry Service off or add laundry staff first.
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {laundryUsers.map((user) => {
                    const checked = access.laundryTeamUserIds.includes(user.id);
                    return (
                      <label
                        key={user.id}
                        className="flex items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLaundryMember(user.id)}
                          className="accent-[hsl(var(--e-primary))]"
                        />
                        <span className="min-w-0">
                          <span className="font-[550]">{user.name}</span>{" "}
                          {user.email ? (
                            <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{user.email}</span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      {/* Quality & accountability */}
      <ECard>
        <ECardHeader className="pb-2">
          <ECardTitle className="text-[0.95rem]">Quality &amp; accountability</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <EField label="Clean duration (min)" hint="Standard clean duration">
              <EInput
                type="number"
                min="0"
                value={form.cleaningDurationMinutes}
                onChange={(e) => setF("cleaningDurationMinutes", e.target.value)}
              />
            </EField>
            <EField label="Cleaner service rate ($)" hint="Per-clean cleaner rate — overrides hourly maths">
              <EInput
                type="number"
                min="0"
                step="0.01"
                value={form.cleanerServiceRate}
                onChange={(e) => setF("cleanerServiceRate", e.target.value)}
              />
            </EField>
            <EField label="Sofa beds" hint="Number of sofa beds at this property">
              <EInput
                type="number"
                min="0"
                value={form.sofaBedCount}
                onChange={(e) => setF("sofaBedCount", e.target.value)}
              />
            </EField>
            <EField label="Laundry bag label" hint='e.g. "J04"'>
              <EInput value={form.laundryBagLabel} onChange={(e) => setF("laundryBagLabel", e.target.value)} />
            </EField>
          </div>
          <EField label="Laundry bag colour">
            <LaundryBagColorPicker value={form.laundryBagColor} onChange={(c) => setF("laundryBagColor", c)} />
          </EField>
          <PropertySetupGuideEditor value={setupGuide} onChange={setSetupGuide} />
        </ECardBody>
      </ECard>

      {/* Notes */}
      <ECard>
        <ECardHeader className="pb-2">
          <ECardTitle className="text-[0.95rem]">Notes</ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          <ETextarea value={form.notes} onChange={(e) => setF("notes", e.target.value)} />
        </ECardBody>
      </ECard>

      <div className="flex justify-end gap-2">
        <EButton asChild variant="outline">
          <Link href="/v2/admin/properties">Cancel</Link>
        </EButton>
        <EButton variant="gold" onClick={createProperty} disabled={saving}>
          {saving ? "Creating…" : "Create property"}
        </EButton>
      </div>
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
