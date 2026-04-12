"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Package, ShoppingCart, Building2, Download, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";
import {
  INVENTORY_LOCATIONS,
  INVENTORY_LOCATION_LABELS,
  normalizeInventoryLocation,
  type InventoryLocation,
} from "@/lib/inventory/locations";

type InventoryItem = {
  id: string;
  name: string;
  sku?: string | null;
  category: string;
  location: InventoryLocation;
  unit: string;
  supplier?: string | null;
  unitCost?: number | null;
  isActive: boolean;
};

type ImportRowError = {
  line: number;
  message: string;
  row?: Record<string, string>;
};

type RecipientUser = {
  id: string;
  name: string | null;
  email: string;
};

export default function InventoryPage() {
  const [properties, setProperties] = useState<any[]>([]);
  const [propertySummaries, setPropertySummaries] = useState<
    Array<{ propertyId: string; propertyName: string; suburb: string; trackedItems: number; lowStockCount: number }>
  >([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [selectedProp, setSelectedProp] = useState<string>("all");
  const [stocks, setStocks] = useState<any[]>([]);
  const [shoppingList, setShoppingList] = useState<Record<string, any[]>>({});
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [presetItems, setPresetItems] = useState<InventoryItem[]>([]);
  const [savingStock, setSavingStock] = useState(false);
  const [activeTab, setActiveTab] = useState("shopping");
  const [importCsv, setImportCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportRowError[]>([]);
  const [recipientUsers, setRecipientUsers] = useState<RecipientUser[]>([]);
  const [downloadingShoppingPdf, setDownloadingShoppingPdf] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [recipientMode, setRecipientMode] = useState<"user" | "custom">("user");
  const [selectedRecipientUserId, setSelectedRecipientUserId] = useState("");
  const [customRecipientEmail, setCustomRecipientEmail] = useState("");
  const [emailSubject, setEmailSubject] = useState("");

  const [newItemMode, setNewItemMode] = useState<"preset" | "custom">("preset");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [newItem, setNewItem] = useState({
    name: "",
    sku: "",
    category: "Custom",
    location: "CLEANERS_CUPBOARD" as InventoryLocation,
    unit: "unit",
    supplier: "",
    unitCost: "",
  });

  const [stockDraft, setStockDraft] = useState<Record<string, { onHand: string; parLevel: string; reorderThreshold: string }>>({});

  // Stock count state
  const [stockCounts, setStockCounts] = useState<any[]>([]);
  const [loadingStockCounts, setLoadingStockCounts] = useState(false);
  const [countDraft, setCountDraft] = useState<Record<string, string>>({});
  const [countNotes, setCountNotes] = useState<Record<string, string>>({});
  const [savingCount, setSavingCount] = useState(false);
  const [applyingCount, setApplyingCount] = useState<string | null>(null);

  async function loadBase() {
    const [pRes, iRes, dRes, uRes] = await Promise.all([
      fetch("/api/admin/properties"),
      fetch("/api/admin/inventory/items"),
      fetch("/api/admin/inventory/defaults"),
      fetch("/api/admin/users"),
    ]);
    const [pData, iData, dData, uData] = await Promise.all([pRes.json(), iRes.json(), dRes.json(), uRes.json()]);
    setProperties(Array.isArray(pData) ? pData : []);
    const normalizedItems = Array.isArray(iData)
      ? iData.map((row: any) => ({
          ...row,
          location: normalizeInventoryLocation(row?.location),
        }))
      : [];
    setItems(normalizedItems);
    const presets = Array.isArray(dData) ? dData : [];
    setPresetItems(
      presets.map((row: any) => ({
        ...row,
        location: normalizeInventoryLocation(row?.location),
      }))
    );
    if (presets.length > 0) setSelectedPresetId(presets[0].id);
    const users = Array.isArray(uData)
      ? uData
          .filter((user: any) => typeof user?.id === "string" && typeof user?.email === "string")
          .map((user: any) => ({ id: user.id, name: user.name ?? null, email: user.email }))
      : [];
    setRecipientUsers(users);
    if (users.length > 0 && !selectedRecipientUserId) {
      setSelectedRecipientUserId(users[0].id);
    }
    await loadPropertySummaries(Array.isArray(pData) ? pData : []);
  }

  async function loadPropertySummaries(propertyRows: any[]) {
    setLoadingSummary(true);
    const summaries = await Promise.all(
      propertyRows.map(async (property) => {
        const res = await fetch(`/api/admin/inventory/property/${property.id}`);
        const rows = await res.json().catch(() => []);
        const stockRows = Array.isArray(rows) ? rows : [];
        const lowStockCount = stockRows.filter((row: any) => row.onHand <= row.reorderThreshold).length;
        return {
          propertyId: property.id,
          propertyName: property.name,
          suburb: property.suburb,
          trackedItems: stockRows.length,
          lowStockCount,
        };
      })
    );
    setPropertySummaries(summaries.sort((a, b) => a.propertyName.localeCompare(b.propertyName)));
    setLoadingSummary(false);
  }

  async function loadPropertyData(propertyId: string) {
    if (propertyId !== "all") {
      const stockRes = await fetch(`/api/admin/inventory/property/${propertyId}`);
      const stockData = await stockRes.json();
      const rows = Array.isArray(stockData) ? stockData : [];
      const byItemId = new Map(rows.map((row: any) => [row.itemId, row]));
      const mergedRows = items
        .filter((item) => item.isActive)
        .map((item) => {
          const existing = byItemId.get(item.id);
          if (existing) return existing;
          return {
            id: `new-${item.id}`,
            propertyId,
            itemId: item.id,
            onHand: 0,
            parLevel: 0,
            reorderThreshold: 0,
            item,
          };
        });
      setStocks(mergedRows);
      const draft: Record<string, { onHand: string; parLevel: string; reorderThreshold: string }> = {};
      for (const row of mergedRows) {
        draft[row.itemId] = {
          onHand: String(row.onHand ?? 0),
          parLevel: String(row.parLevel ?? 0),
          reorderThreshold: String(row.reorderThreshold ?? 0),
        };
      }
      setStockDraft(draft);
    } else {
      setStocks([]);
      setStockDraft({});
    }

    const shoppingRes = await fetch(`/api/admin/inventory/shopping-list?scope=${propertyId}`);
    const shoppingData = await shoppingRes.json();
    setShoppingList(shoppingData && typeof shoppingData === "object" ? shoppingData : {});
    await loadStockCounts(propertyId);
  }

  async function loadStockCounts(propertyId: string) {
    if (propertyId === "all") return;
    setLoadingStockCounts(true);
    try {
      const res = await fetch(`/api/admin/inventory/stock-counts?propertyId=${propertyId}`);
      const data = await res.json().catch(() => []);
      setStockCounts(Array.isArray(data) ? data : []);
    } catch {
      setStockCounts([]);
    } finally {
      setLoadingStockCounts(false);
    }
  }

  async function startStockCount() {
    if (selectedProp === "all") return;
    const lines = stocks.map((row: any) => ({
      propertyStockId: row.id,
      countedOnHand: row.onHand ?? 0,
      note: null,
    }));

    setSavingCount(true);
    try {
      const res = await fetch("/api/admin/inventory/stock-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedProp,
          title: `Stock count ${new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}`,
          lines,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not create stock count.");
      }
      toast({ title: "Stock count saved as draft" });
      await loadStockCounts(selectedProp);
    } catch (error: any) {
      toast({ title: "Save failed", description: error?.message ?? "Could not save count.", variant: "destructive" });
    } finally {
      setSavingCount(false);
    }
  }

  async function applyStockCount(runId: string) {
    setApplyingCount(runId);
    try {
      const res = await fetch("/api/admin/inventory/stock-counts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not apply stock count.");
      }
      toast({ title: "Stock count applied", description: "Property stock levels have been updated." });
      await loadStockCounts(selectedProp);
      await loadPropertyData(selectedProp);
      await loadPropertySummaries(properties);
    } catch (error: any) {
      toast({ title: "Apply failed", description: error?.message ?? "Could not apply count.", variant: "destructive" });
    } finally {
      setApplyingCount(null);
    }
  }

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    loadPropertyData(selectedProp);
  }, [selectedProp, items]);

  const shoppingEntries = Object.entries(shoppingList);

  const presetOptions = useMemo(
    () =>
      presetItems
        .filter((preset) => !items.some((item) => item.sku && item.sku === preset.sku))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [presetItems, items]
  );

  const selectedRecipientUser = useMemo(
    () => recipientUsers.find((user) => user.id === selectedRecipientUserId) ?? null,
    [recipientUsers, selectedRecipientUserId]
  );

  async function createInventoryItem() {
    let payload: any;
    if (newItemMode === "preset") {
      const preset = presetItems.find((p) => p.id === selectedPresetId);
      if (!preset) {
        toast({ title: "Select a preset item first.", variant: "destructive" });
        return;
      }
      payload = {
        name: preset.name,
        sku: preset.sku ?? undefined,
        category: preset.category,
        location: preset.location,
        unit: preset.unit,
        supplier: preset.supplier ?? undefined,
        unitCost: typeof preset.unitCost === "number" ? preset.unitCost : undefined,
      };
    } else {
      if (!newItem.name.trim()) {
        toast({ title: "Item name is required.", variant: "destructive" });
        return;
      }
      payload = {
        name: newItem.name.trim(),
        sku: newItem.sku.trim() || undefined,
        category: newItem.category.trim() || "Custom",
        location: newItem.location,
        unit: newItem.unit.trim() || "unit",
        supplier: newItem.supplier.trim() || undefined,
        unitCost: newItem.unitCost.trim() ? Number(newItem.unitCost) : undefined,
      };
    }

    const res = await fetch("/api/admin/inventory/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Create failed", description: body.error ?? "Could not create item.", variant: "destructive" });
      return;
    }

    toast({ title: "Inventory item created" });
    setNewItem({
      name: "",
      sku: "",
      category: "Custom",
      location: "CLEANERS_CUPBOARD",
      unit: "unit",
      supplier: "",
      unitCost: "",
    });
    await loadBase();
  }

  async function saveItem(item: InventoryItem) {
    const res = await fetch(`/api/admin/inventory/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: item.name,
        category: item.category,
        location: item.location,
        unit: item.unit,
        supplier: item.supplier ?? "",
        unitCost: item.unitCost ?? null,
        isActive: item.isActive,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Could not update item.", variant: "destructive" });
      return;
    }
    toast({ title: "Item updated" });
  }

  async function saveStockLevels() {
    if (selectedProp === "all") return;
    setSavingStock(true);
    const levels = Object.entries(stockDraft).map(([itemId, draft]) => ({
      itemId,
      onHand: Number(draft.onHand || 0),
      parLevel: Number(draft.parLevel || 0),
      reorderThreshold: Number(draft.reorderThreshold || 0),
    }));

    const res = await fetch(`/api/admin/inventory/property/${selectedProp}/set-levels`, {
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
    await loadPropertyData(selectedProp);
    await loadPropertySummaries(properties);
  }

  async function handleExport() {
    const query = selectedProp !== "all" ? `?propertyId=${selectedProp}` : "";
    try {
      await downloadFromApi(`/api/admin/inventory/items/export${query}`, `inventory-export-${selectedProp === "all" ? "all" : selectedProp}.csv`);
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message ?? "Could not export inventory.", variant: "destructive" });
    }
  }

  async function downloadShoppingListPdf() {
    setDownloadingShoppingPdf(true);
    try {
      const res = await fetch(`/api/admin/inventory/shopping-list/pdf?scope=${encodeURIComponent(selectedProp)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not generate shopping list PDF.");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shopping-list-${selectedProp === "all" ? "all-properties" : selectedProp}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Shopping list PDF downloaded" });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message ?? "Could not download PDF.", variant: "destructive" });
    } finally {
      setDownloadingShoppingPdf(false);
    }
  }

  async function emailShoppingListPdf() {
    if (recipientMode === "user" && !selectedRecipientUserId) {
      toast({ title: "Select a user first.", variant: "destructive" });
      return;
    }
    if (recipientMode === "custom" && !customRecipientEmail.trim()) {
      toast({ title: "Enter recipient email.", variant: "destructive" });
      return;
    }

    setEmailSending(true);
    try {
      const payload: Record<string, string> = {
        scope: selectedProp,
      };
      if (recipientMode === "user") {
        payload.userId = selectedRecipientUserId;
      } else {
        payload.toEmail = customRecipientEmail.trim();
      }
      if (emailSubject.trim()) {
        payload.subject = emailSubject.trim();
      }

      const res = await fetch("/api/admin/inventory/shopping-list/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not send shopping list email.");
      }
      toast({ title: "Shopping list emailed", description: `Sent to ${body.sentTo ?? "recipient"}` });
      setEmailDialogOpen(false);
      setEmailSubject("");
      if (recipientMode === "custom") {
        setCustomRecipientEmail("");
      }
    } catch (err: any) {
      toast({ title: "Email failed", description: err.message ?? "Could not send email.", variant: "destructive" });
    } finally {
      setEmailSending(false);
    }
  }

  async function handleImport() {
    if (!importCsv.trim()) {
      toast({ title: "Paste CSV content or upload a CSV file first.", variant: "destructive" });
      return;
    }
    setImporting(true);
    setImportErrors([]);
    const res = await fetch("/api/admin/inventory/items/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        csv: importCsv,
        propertyId: selectedProp !== "all" ? selectedProp : undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setImporting(false);
    if (!res.ok) {
      toast({ title: "Import failed", description: body.error ?? "Could not import CSV.", variant: "destructive" });
      return;
    }
    const rowErrors = Array.isArray(body.errors) ? (body.errors as ImportRowError[]) : [];
    setImportErrors(rowErrors);
    toast({
      title: "Import complete",
      description:
        rowErrors.length > 0
          ? `Created ${body.created}, updated ${body.updated}, stock updated ${body.stockUpdated}. ${rowErrors.length} row(s) failed.`
          : `Created ${body.created}, updated ${body.updated}, stock updated ${body.stockUpdated}.`,
      variant: rowErrors.length > 0 ? "destructive" : "default",
    });
    await loadBase();
    await loadPropertyData(selectedProp);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Inventory</h2>
        <Select value={selectedProp} onValueChange={setSelectedProp}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select property" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All properties</SelectItem>
            {properties.map((property: any) => (
              <SelectItem key={property.id} value={property.id}>
                {property.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="properties">
            <Building2 className="mr-2 h-4 w-4" />
            Properties
          </TabsTrigger>
          <TabsTrigger value="shopping">
            <ShoppingCart className="mr-2 h-4 w-4" />
            Shopping List
            {shoppingEntries.length > 0 && (
              <Badge variant="destructive" className="ml-2 text-xs">
                {shoppingEntries.reduce((count, [, rows]) => count + rows.length, 0)}
              </Badge>
            )}
          </TabsTrigger>
          {selectedProp !== "all" && (
            <TabsTrigger value="stock">
              <Package className="mr-2 h-4 w-4" />
              Property Stock
            </TabsTrigger>
          )}
          {selectedProp !== "all" && (
            <TabsTrigger value="stockcount">
              <ClipboardList className="mr-2 h-4 w-4" />
              Stock Count
            </TabsTrigger>
          )}
          <TabsTrigger value="items">Items Master</TabsTrigger>
        </TabsList>

        <TabsContent value="properties">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-Property Inventory Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingSummary ? (
                <p className="p-6 text-sm text-muted-foreground">Loading property summaries...</p>
              ) : propertySummaries.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No properties found.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-xs text-muted-foreground">
                      <th className="p-3 text-left">Property</th>
                      <th className="p-3 text-left">Suburb</th>
                      <th className="p-3 text-right">Tracked Items</th>
                      <th className="p-3 text-right">Low Stock</th>
                      <th className="p-3 text-right">Manage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {propertySummaries.map((summary) => (
                      <tr key={summary.propertyId}>
                        <td className="p-3 font-medium">{summary.propertyName}</td>
                        <td className="p-3 text-muted-foreground">{summary.suburb}</td>
                        <td className="p-3 text-right">{summary.trackedItems}</td>
                        <td className="p-3 text-right">
                          <Badge variant={summary.lowStockCount > 0 ? "destructive" : "secondary"}>{summary.lowStockCount}</Badge>
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedProp(summary.propertyId);
                              setActiveTab("stock");
                            }}
                          >
                            Edit stock
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shopping" className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="text-sm text-muted-foreground">
                Export the current shopping list scope as PDF or email it directly.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadShoppingListPdf} disabled={downloadingShoppingPdf}>
                  <Download className="mr-2 h-4 w-4" />
                  {downloadingShoppingPdf ? "Preparing PDF..." : "Download PDF"}
                </Button>
                <Button variant="outline" onClick={() => setEmailDialogOpen(true)}>
                  <Mail className="mr-2 h-4 w-4" />
                  Email PDF
                </Button>
              </div>
            </CardContent>
          </Card>

          {shoppingEntries.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">All stock levels are healthy.</p>
          ) : (
            shoppingEntries.map(([key, rows]) => {
              const [category, supplier] = key.split("||");
              return (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                      {category} - {supplier}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {rows.map((row, index) => (
                        <div key={index} className="flex items-center justify-between rounded bg-muted/50 p-2 text-sm">
                          <div>
                            <p className="font-medium">{row.item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {row.propertyName} - {row.suburb}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">
                              On hand: {row.onHand} {row.item.unit}
                            </p>
                            <p className="text-xs font-medium text-destructive">
                              Need: {row.needed} {row.item.unit}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {selectedProp !== "all" && (
          <TabsContent value="stock">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Editable Stock Levels</CardTitle>
                <Button onClick={saveStockLevels} disabled={savingStock}>
                  {savingStock ? "Saving..." : "Save levels"}
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-xs text-muted-foreground">
                      <th className="p-3 text-left">Item</th>
                      <th className="p-3 text-left">Location</th>
                      <th className="p-3 text-left">Category</th>
                      <th className="p-3 text-right">On Hand</th>
                      <th className="p-3 text-right">Par</th>
                      <th className="p-3 text-right">Threshold</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {stocks.map((stock: any) => {
                      const draft = stockDraft[stock.itemId] ?? {
                        onHand: String(stock.onHand ?? 0),
                        parLevel: String(stock.parLevel ?? 0),
                        reorderThreshold: String(stock.reorderThreshold ?? 0),
                      };
                      return (
                        <tr key={stock.id}>
                          <td className="p-3 font-medium">{stock.item.name}</td>
                          <td className="p-3 text-muted-foreground">
                            {INVENTORY_LOCATION_LABELS[(stock.item.location as InventoryLocation) ?? "CLEANERS_CUPBOARD"] ??
                              stock.item.location ??
                              "Cleaners Cupboard"}
                          </td>
                          <td className="p-3 text-muted-foreground">{stock.item.category}</td>
                          <td className="p-3 text-right">
                            <Input
                              className="ml-auto w-24 text-right"
                              type="number"
                              min="0"
                              value={draft.onHand}
                              onChange={(e) =>
                                setStockDraft((prev) => ({
                                  ...prev,
                                  [stock.itemId]: { ...draft, onHand: e.target.value },
                                }))
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
                                setStockDraft((prev) => ({
                                  ...prev,
                                  [stock.itemId]: { ...draft, parLevel: e.target.value },
                                }))
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
                                setStockDraft((prev) => ({
                                  ...prev,
                                  [stock.itemId]: { ...draft, reorderThreshold: e.target.value },
                                }))
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {selectedProp !== "all" && (
          <TabsContent value="stockcount" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Guided Stock Count</CardTitle>
                <Button onClick={startStockCount} disabled={savingCount || stocks.length === 0}>
                  {savingCount ? "Saving..." : "Start New Count"}
                </Button>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">
                  Count all visible items grouped by location. Submit as a draft run for admin review before applying changes.
                </p>
              </CardContent>
            </Card>

            {loadingStockCounts ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Loading stock counts...</p>
            ) : stockCounts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No stock counts yet. Start a new count above.</p>
            ) : (
              <div className="space-y-4">
                {stockCounts.map((run: any) => {
                  const statusColors: Record<string, "secondary" | "default" | "warning" | "success" | "outline"> = {
                    DRAFT: "secondary",
                    ACTIVE: "default",
                    SUBMITTED: "warning",
                    APPLIED: "success",
                    DISCARDED: "outline",
                  };
                  const linesByLocation = new Map<string, any[]>();
                  for (const line of run.lines ?? []) {
                    const loc = line.propertyStock?.item?.location ?? "UNKNOWN";
                    if (!linesByLocation.has(loc)) linesByLocation.set(loc, []);
                    linesByLocation.get(loc)!.push(line);
                  }

                  return (
                    <Card key={run.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-base">{run.title}</CardTitle>
                            <p className="text-xs text-muted-foreground">
                              {new Date(run.createdAt).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                              {" · "}{run.lines?.length ?? 0} items
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={statusColors[run.status] ?? "secondary"}>{run.status}</Badge>
                            {(run.status === "DRAFT" || run.status === "SUBMITTED") && (
                              <Button
                                size="sm"
                                onClick={() => applyStockCount(run.id)}
                                disabled={applyingCount === run.id}
                              >
                                {applyingCount === run.id ? "Applying..." : "Apply"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="p-0">
                        {Array.from(linesByLocation.entries()).map(([location, lines]) => (
                          <div key={location} className="border-t">
                            <div className="bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
                              {(INVENTORY_LOCATION_LABELS as Record<string, string>)[location] ?? location}
                            </div>
                            <table className="w-full text-sm">
                              <thead className="border-b text-xs text-muted-foreground">
                                <tr>
                                  <th className="p-2 text-left">Item</th>
                                  <th className="p-2 text-right">Expected</th>
                                  <th className="p-2 text-right">Counted</th>
                                  <th className="p-2 text-right">Variance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((line: any) => {
                                  const variance = line.variance ?? 0;
                                  const varianceColor = variance < 0 ? "text-destructive" : variance > 0 ? "text-green-600" : "text-muted-foreground";
                                  return (
                                    <tr key={line.id} className="border-b last:border-0">
                                      <td className="p-2 font-medium">{line.propertyStock?.item?.name ?? "Unknown"}</td>
                                      <td className="p-2 text-right text-muted-foreground">{line.expectedOnHand}</td>
                                      <td className="p-2 text-right">{line.countedOnHand ?? "-"}</td>
                                      <td className={`p-2 text-right font-medium ${varianceColor}`}>
                                        {line.countedOnHand != null ? (variance > 0 ? "+" : "") + variance : "-"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="items" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bulk Import / Export CSV</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleExport}>
                  Export CSV {selectedProp !== "all" ? "(with selected property stock)" : "(items master)"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setImportCsv(
                      "name,sku,category,location,unit,supplier,isActive,onHand,parLevel,reorderThreshold\nToilet Paper,TP-001,Bathroom,BATHROOM,roll,Costco,true,24,24,8"
                    );
                  }}
                >
                  Insert sample template
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label>Import CSV content</Label>
                <textarea
                  className="min-h-[140px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={importCsv}
                  onChange={(e) => setImportCsv(e.target.value)}
                  placeholder="Paste CSV here..."
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setImportCsv(text);
                  }}
                />
                <Button onClick={handleImport} disabled={importing}>
                  {importing ? "Importing..." : "Import CSV"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Required columns: <code>name</code>. Optional columns: <code>sku,category,location,unit,supplier,isActive,onHand,parLevel,reorderThreshold</code>.
              </p>
              {importErrors.length > 0 ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">Import row errors</p>
                  <div className="mt-2 max-h-56 space-y-2 overflow-auto text-xs">
                    {importErrors.map((error, index) => (
                      <div key={`${error.line}-${index}`} className="rounded border bg-background p-2">
                        <p className="font-medium">
                          Line {error.line}: {error.message}
                        </p>
                        {error.row ? (
                          <pre className="mt-1 whitespace-pre-wrap text-muted-foreground">{JSON.stringify(error.row, null, 2)}</pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add Inventory Item</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <Button variant={newItemMode === "preset" ? "default" : "outline"} onClick={() => setNewItemMode("preset")}>
                  From Preset
                </Button>
                <Button variant={newItemMode === "custom" ? "default" : "outline"} onClick={() => setNewItemMode("custom")}>
                  Custom
                </Button>
              </div>

              {newItemMode === "preset" ? (
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <Select value={selectedPresetId} onValueChange={setSelectedPresetId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose preset item" />
                    </SelectTrigger>
                    <SelectContent>
                      {presetOptions.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.name} ({INVENTORY_LOCATION_LABELS[preset.location]} - {preset.category})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={createInventoryItem} disabled={!selectedPresetId}>
                    Add preset item
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-7">
                  <Input placeholder="Name" value={newItem.name} onChange={(e) => setNewItem((prev) => ({ ...prev, name: e.target.value }))} />
                  <Input placeholder="SKU (optional)" value={newItem.sku} onChange={(e) => setNewItem((prev) => ({ ...prev, sku: e.target.value }))} />
                  <Input placeholder="Category" value={newItem.category} onChange={(e) => setNewItem((prev) => ({ ...prev, category: e.target.value }))} />
                  <Select
                    value={newItem.location}
                    onValueChange={(value: InventoryLocation) =>
                      setNewItem((prev) => ({ ...prev, location: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Location" />
                    </SelectTrigger>
                    <SelectContent>
                      {INVENTORY_LOCATIONS.map((location) => (
                        <SelectItem key={location} value={location}>
                          {INVENTORY_LOCATION_LABELS[location]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Unit" value={newItem.unit} onChange={(e) => setNewItem((prev) => ({ ...prev, unit: e.target.value }))} />
                  <Input placeholder="Supplier" value={newItem.supplier} onChange={(e) => setNewItem((prev) => ({ ...prev, supplier: e.target.value }))} />
                  <Input
                    placeholder="Unit cost (optional)"
                    type="number"
                    min="0"
                    step="0.01"
                    value={newItem.unitCost}
                    onChange={(e) => setNewItem((prev) => ({ ...prev, unitCost: e.target.value }))}
                  />
                </div>
              )}

              {newItemMode === "custom" && (
                <div className="flex justify-end">
                  <Button onClick={createInventoryItem}>Add custom item</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Items Master List</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-xs text-muted-foreground">
                    <th className="p-3 text-left">Name</th>
                    <th className="p-3 text-left">SKU</th>
                    <th className="p-3 text-left">Location</th>
                    <th className="p-3 text-left">Category</th>
                    <th className="p-3 text-left">Unit</th>
                    <th className="p-3 text-left">Supplier</th>
                    <th className="p-3 text-right">Unit Cost</th>
                    <th className="p-3 text-center">Active</th>
                    <th className="p-3 text-right">Save</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="p-3">
                        <Input
                          value={item.name}
                          onChange={(e) =>
                            setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, name: e.target.value } : row)))
                          }
                        />
                      </td>
                      <td className="p-3 text-muted-foreground">{item.sku ?? "-"}</td>
                      <td className="p-3">
                        <Select
                          value={item.location}
                          onValueChange={(value: InventoryLocation) =>
                            setItems((prev) =>
                              prev.map((row) =>
                                row.id === item.id ? { ...row, location: value } : row
                              )
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {INVENTORY_LOCATIONS.map((location) => (
                              <SelectItem key={`${item.id}-${location}`} value={location}>
                                {INVENTORY_LOCATION_LABELS[location]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3">
                        <Input
                          value={item.category}
                          onChange={(e) =>
                            setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, category: e.target.value } : row)))
                          }
                        />
                      </td>
                      <td className="p-3">
                        <Input
                          value={item.unit}
                          onChange={(e) =>
                            setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, unit: e.target.value } : row)))
                          }
                        />
                      </td>
                      <td className="p-3">
                        <Input
                          value={item.supplier ?? ""}
                          onChange={(e) =>
                            setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, supplier: e.target.value } : row)))
                          }
                        />
                      </td>
                      <td className="p-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="ml-auto w-28 text-right"
                          value={item.unitCost ?? ""}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((row) =>
                                row.id === item.id
                                  ? { ...row, unitCost: e.target.value === "" ? null : Number(e.target.value) }
                                  : row
                              )
                            )
                          }
                        />
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={item.isActive}
                          onChange={(e) =>
                            setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, isActive: e.target.checked } : row)))
                          }
                        />
                      </td>
                      <td className="p-3 text-right">
                        <Button size="sm" onClick={() => saveItem(item)}>
                          Save
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email Shopping List PDF</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={recipientMode === "user" ? "default" : "outline"}
                onClick={() => setRecipientMode("user")}
              >
                Select user
              </Button>
              <Button
                type="button"
                variant={recipientMode === "custom" ? "default" : "outline"}
                onClick={() => setRecipientMode("custom")}
              >
                Custom email
              </Button>
            </div>

            {recipientMode === "user" ? (
              <div className="space-y-2">
                <Label>User recipient</Label>
                <Select value={selectedRecipientUserId} onValueChange={setSelectedRecipientUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
                    {recipientUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name ?? user.email} ({user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedRecipientUser ? (
                  <p className="text-xs text-muted-foreground">
                    This will use the selected user profile email: {selectedRecipientUser.email}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Custom recipient email</Label>
                <Input
                  type="email"
                  value={customRecipientEmail}
                  onChange={(e) => setCustomRecipientEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Subject (optional)</Label>
              <Input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Inventory shopping list"
              />
            </div>

            <Button className="w-full" onClick={emailShoppingListPdf} disabled={emailSending}>
              {emailSending ? "Sending..." : "Send PDF by Email"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
