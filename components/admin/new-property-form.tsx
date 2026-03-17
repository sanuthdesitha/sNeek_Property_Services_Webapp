"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PropertyAccessFields, type PropertyAccessInfo } from "@/components/admin/property-access-fields";
import { GoogleAddressInput } from "@/components/shared/google-address-input";
import { toast } from "@/hooks/use-toast";
import {
  INVENTORY_LOCATIONS,
  INVENTORY_LOCATION_LABELS,
  type InventoryLocation,
} from "@/lib/inventory/locations";

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

interface NewPropertyFormProps {
  initialClientId?: string;
  copyFromPropertyId?: string;
}

export function NewPropertyForm({ initialClientId, copyFromPropertyId }: NewPropertyFormProps) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [defaultInventoryItems, setDefaultInventoryItems] = useState<InventoryOption[]>([]);
  const [selectedDefaultItemIds, setSelectedDefaultItemIds] = useState<string[]>([]);
  const [customItems, setCustomItems] = useState<
    Array<{
      name: string;
      category: string;
      location: InventoryLocation;
      unit: string;
      supplier: string;
      onHand: string;
      parLevel: string;
      reorderThreshold: string;
    }>
  >([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copySourceName, setCopySourceName] = useState<string | null>(null);
  const [accessInfo, setAccessInfo] = useState<PropertyAccessInfo>({
    lockbox: "",
    codes: "",
    parking: "",
    other: "",
    instructions: "",
    attachments: [],
  });

  const [form, setForm] = useState({
    clientId: initialClientId ?? "",
    name: "",
    address: "",
    suburb: "",
    state: "NSW",
    postcode: "",
    notes: "",
    linenBufferSets: "0",
    defaultCleanDurationHours: "3",
    inventoryEnabled: false,
    defaultCheckinTime: "14:00",
    defaultCheckoutTime: "10:00",
    hasBalcony: false,
    bedrooms: "1",
    bathrooms: "1",
  });

  useEffect(() => {
    async function loadInitialData() {
      try {
        const requests: Promise<any>[] = [
          fetch("/api/admin/clients").then((r) => r.json()),
          fetch("/api/admin/inventory/defaults").then((r) => r.json()),
        ];
        if (copyFromPropertyId) {
          requests.push(fetch(`/api/admin/properties/${copyFromPropertyId}`).then((r) => r.json()));
        }

        const results = await Promise.all(requests);
        const [clientData, inventoryData, copySource] = results;

        setClients(
          Array.isArray(clientData) ? clientData.map((c: any) => ({ id: c.id, name: c.name })) : []
        );

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
          const access = (copySource.accessInfo ?? {}) as Record<string, unknown>;
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
          setForm((prev) => ({
            ...prev,
            clientId: copySource.clientId ?? prev.clientId,
            name: copySource.name ? `${copySource.name} (Copy)` : prev.name,
            address: copySource.address ?? "",
            suburb: copySource.suburb ?? "",
            state: copySource.state ?? "NSW",
            postcode: copySource.postcode ?? "",
            notes: copySource.notes ?? "",
            linenBufferSets: String(copySource.linenBufferSets ?? 0),
            defaultCleanDurationHours:
              typeof access.defaultCleanDurationHours === "number"
                ? String(access.defaultCleanDurationHours)
                : "3",
            inventoryEnabled: Boolean(copySource.inventoryEnabled),
            defaultCheckinTime: copySource.defaultCheckinTime ?? "14:00",
            defaultCheckoutTime: copySource.defaultCheckoutTime ?? "10:00",
            hasBalcony: Boolean(copySource.hasBalcony),
            bedrooms: String(copySource.bedrooms ?? 1),
            bathrooms: String(copySource.bathrooms ?? 1),
          }));

          const defaultIdSet = new Set(defaults.map((item) => item.id));
          const stockRows = Array.isArray(copySource.propertyStock) ? copySource.propertyStock : [];
          const copiedDefaultIds = stockRows
            .filter((row: any) => defaultIdSet.has(row.itemId))
            .map((row: any) => row.itemId);
          setSelectedDefaultItemIds(copiedDefaultIds);
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
              }))
          );
        }
      } finally {
        setLoadingClients(false);
      }
    }

    loadInitialData();
  }, [copyFromPropertyId]);

  async function createProperty() {
    if (!form.clientId || !form.name.trim() || !form.address.trim() || !form.suburb.trim()) {
      toast({ title: "Client, name, address, and suburb are required.", variant: "destructive" });
      return;
    }

    const normalizedAttachments = (accessInfo.attachments ?? []).filter((item) => item.url);
    const accessPayload =
      (Number(form.defaultCleanDurationHours) > 0) ||
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
            lockbox: accessInfo.lockbox || undefined,
            codes: accessInfo.codes || undefined,
            parking: accessInfo.parking || undefined,
            other: accessInfo.other || undefined,
            instructions: accessInfo.instructions || undefined,
            attachments: normalizedAttachments.length > 0 ? normalizedAttachments : undefined,
          }
        : undefined;

    const payload = {
      clientId: form.clientId,
      name: form.name,
      address: form.address,
      suburb: form.suburb,
      state: form.state || "NSW",
      postcode: form.postcode || undefined,
      notes: form.notes || undefined,
      accessInfo: accessPayload,
      linenBufferSets: Number(form.linenBufferSets) || 0,
      inventoryEnabled: form.inventoryEnabled,
      defaultCheckinTime: form.defaultCheckinTime,
      defaultCheckoutTime: form.defaultCheckoutTime,
      hasBalcony: form.hasBalcony,
      bedrooms: Number(form.bedrooms) || 0,
      bathrooms: Number(form.bathrooms) || 0,
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
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to create property.");
      }

      toast({ title: "Property created" });
      router.push(`/admin/properties/${body.id}`);
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{copySourceName ? "Copy Property" : "Add Property"}</h2>
          <p className="text-sm text-muted-foreground">
            {copySourceName
              ? `Create a new property using "${copySourceName}" as the template.`
              : "Create a property under a client account."}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/properties">Back</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Property Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Client</Label>
            <Select
              value={form.clientId}
              onValueChange={(value) => setForm((prev) => ({ ...prev, clientId: value }))}
              disabled={loadingClients}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingClients ? "Loading clients..." : "Select a client"} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Property Name</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="suburb">Suburb</Label>
              <Input id="suburb" value={form.suburb} onChange={(e) => setForm((prev) => ({ ...prev, suburb: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="address">Address</Label>
            <GoogleAddressInput
              id="address"
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

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="state">State</Label>
              <Input id="state" value={form.state} onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="postcode">Postcode</Label>
              <Input
                id="postcode"
                value={form.postcode}
                onChange={(e) => setForm((prev) => ({ ...prev, postcode: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="linenBufferSets">Linen Buffer Sets</Label>
              <Input
                id="linenBufferSets"
                type="number"
                min="0"
                value={form.linenBufferSets}
                onChange={(e) => setForm((prev) => ({ ...prev, linenBufferSets: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="defaultCleanDurationHours">Default Clean Duration (hours)</Label>
              <Input
                id="defaultCleanDurationHours"
                type="number"
                min="0.25"
                step="0.25"
                value={form.defaultCleanDurationHours}
                onChange={(e) => setForm((prev) => ({ ...prev, defaultCleanDurationHours: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bedrooms">Bedrooms</Label>
              <Input
                id="bedrooms"
                type="number"
                min="0"
                value={form.bedrooms}
                onChange={(e) => setForm((prev) => ({ ...prev, bedrooms: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bathrooms">Bathrooms</Label>
              <Input
                id="bathrooms"
                type="number"
                min="0"
                value={form.bathrooms}
                onChange={(e) => setForm((prev) => ({ ...prev, bathrooms: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="defaultCheckinTime">Default Check-in Time</Label>
              <Input
                id="defaultCheckinTime"
                type="time"
                value={form.defaultCheckinTime}
                onChange={(e) => setForm((prev) => ({ ...prev, defaultCheckinTime: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="defaultCheckoutTime">Default Checkout Time</Label>
              <Input
                id="defaultCheckoutTime"
                type="time"
                value={form.defaultCheckoutTime}
                onChange={(e) => setForm((prev) => ({ ...prev, defaultCheckoutTime: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Has Balcony</p>
                <p className="text-xs text-muted-foreground">Enable balcony checklist fields.</p>
              </div>
              <Switch
                checked={form.hasBalcony}
                onCheckedChange={(value) => setForm((prev) => ({ ...prev, hasBalcony: value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Inventory Enabled</p>
                <p className="text-xs text-muted-foreground">Track stock for this property.</p>
              </div>
              <Switch
                checked={form.inventoryEnabled}
                onCheckedChange={(value) => setForm((prev) => ({ ...prev, inventoryEnabled: value }))}
              />
            </div>
          </div>

          {form.inventoryEnabled && (
            <div className="space-y-4 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Default Airbnb Inventory Items</p>
                  <p className="text-xs text-muted-foreground">
                    Turn items on/off for this property at creation.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedDefaultItemIds(defaultInventoryItems.map((item) => item.id))}
                >
                  Select all
                </Button>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {defaultInventoryItems.map((item) => {
                  const checked = selectedDefaultItemIds.includes(item.id);
                  return (
                    <label key={item.id} className="flex items-center gap-2 rounded border p-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedDefaultItemIds((prev) =>
                            e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)
                          )
                        }
                      />
                      <span>
                        {item.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({INVENTORY_LOCATION_LABELS[item.location]} - {item.category})
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Custom items for this property</p>
                  <Button
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
                    Add custom item
                  </Button>
                </div>

                {customItems.length === 0 && (
                  <p className="text-xs text-muted-foreground">No custom items added yet.</p>
                )}

                <div className="space-y-2">
                  {customItems.map((item, index) => (
                    <div key={index} className="grid gap-2 rounded-md border p-2 md:grid-cols-8">
                      <Input
                        placeholder="Item name"
                        value={item.name}
                        onChange={(e) =>
                          setCustomItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, name: e.target.value } : row))
                          )
                        }
                      />
                      <Input
                        placeholder="Category"
                        value={item.category}
                        onChange={(e) =>
                          setCustomItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, category: e.target.value } : row))
                          )
                        }
                      />
                      <Select
                        value={item.location}
                        onValueChange={(value: InventoryLocation) =>
                          setCustomItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, location: value } : row))
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Location" />
                        </SelectTrigger>
                        <SelectContent>
                          {INVENTORY_LOCATIONS.map((location) => (
                            <SelectItem key={`${index}-${location}`} value={location}>
                              {INVENTORY_LOCATION_LABELS[location]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Unit"
                        value={item.unit}
                        onChange={(e) =>
                          setCustomItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, unit: e.target.value } : row))
                          )
                        }
                      />
                      <Input
                        placeholder="Supplier"
                        value={item.supplier}
                        onChange={(e) =>
                          setCustomItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, supplier: e.target.value } : row))
                          )
                        }
                      />
                      <Input
                        type="number"
                        min="0"
                        placeholder="On hand"
                        value={item.onHand}
                        onChange={(e) =>
                          setCustomItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, onHand: e.target.value } : row))
                          )
                        }
                      />
                      <Input
                        type="number"
                        min="0"
                        placeholder="Par"
                        value={item.parLevel}
                        onChange={(e) =>
                          setCustomItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, parLevel: e.target.value } : row))
                          )
                        }
                      />
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          min="0"
                          placeholder="Threshold"
                          value={item.reorderThreshold}
                          onChange={(e) =>
                            setCustomItems((prev) =>
                              prev.map((row, i) =>
                                i === index ? { ...row, reorderThreshold: e.target.value } : row
                              )
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setCustomItems((prev) => prev.filter((_, i) => i !== index))}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

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

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>

          <div className="flex justify-end">
            <Button onClick={createProperty} disabled={saving}>
              {saving ? "Creating..." : "Create property"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
