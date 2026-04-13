"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useBasicConfirmDialog } from "@/components/shared/use-basic-confirm";

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  defaultLeadDays: number;
  categories: string[];
  notes: string | null;
  isActive: boolean;
};

export default function SuppliersPage() {
  const { confirm, dialog } = useBasicConfirmDialog();
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newSupplier, setNewSupplier] = useState({
    name: "",
    email: "",
    phone: "",
    website: "",
    defaultLeadDays: "0",
    categories: "",
    notes: "",
  });

  async function loadRows() {
    setLoading(true);
    const res = await fetch("/api/admin/inventory/suppliers");
    const body = await res.json().catch(() => []);
    setRows(Array.isArray(body) ? (body as Supplier[]) : []);
    setLoading(false);
  }

  useEffect(() => {
    loadRows();
  }, []);

  async function createSupplier() {
    if (!newSupplier.name.trim()) {
      toast({ title: "Supplier name is required.", variant: "destructive" });
      return;
    }
    setSavingId("new");
    const res = await fetch("/api/admin/inventory/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newSupplier.name.trim(),
        email: newSupplier.email.trim() || null,
        phone: newSupplier.phone.trim() || null,
        website: newSupplier.website.trim() || null,
        defaultLeadDays: Number(newSupplier.defaultLeadDays || 0),
        categories: newSupplier.categories
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        notes: newSupplier.notes.trim() || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) {
      toast({
        title: "Create failed",
        description: body.error ?? "Could not create supplier.",
        variant: "destructive",
      });
      return;
    }
    setNewSupplier({
      name: "",
      email: "",
      phone: "",
      website: "",
      defaultLeadDays: "0",
      categories: "",
      notes: "",
    });
    await loadRows();
  }

  async function saveSupplier(row: Supplier) {
    setSavingId(row.id);
    const res = await fetch(`/api/admin/inventory/suppliers/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...row,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) {
      toast({
        title: "Save failed",
        description: body.error ?? "Could not update supplier.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Supplier updated" });
    await loadRows();
  }

  async function deleteSupplier(id: string) {
    const approved = await confirm({
      title: "Delete supplier",
      description: "This will remove the supplier from the inventory catalog.",
      confirmLabel: "Delete supplier",
      actionKey: "deleteSupplier",
    });
    if (!approved) return;
    setSavingId(id);
    const res = await fetch(`/api/admin/inventory/suppliers/${id}`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) {
      toast({
        title: "Delete failed",
        description: body.error ?? "Could not delete supplier.",
        variant: "destructive",
      });
      return;
    }
    await loadRows();
  }

  return (
    <div className="space-y-6">
      {dialog}
      <div>
        <h2 className="text-2xl font-bold">Supplier Catalog</h2>
        <p className="text-sm text-muted-foreground">
          Manage supplier contact details and purchasing defaults.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Supplier</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="Supplier name"
              value={newSupplier.name}
              onChange={(event) =>
                setNewSupplier((prev) => ({ ...prev, name: event.target.value }))
              }
            />
            <Input
              placeholder="Email"
              value={newSupplier.email}
              onChange={(event) =>
                setNewSupplier((prev) => ({ ...prev, email: event.target.value }))
              }
            />
            <Input
              placeholder="Phone"
              value={newSupplier.phone}
              onChange={(event) =>
                setNewSupplier((prev) => ({ ...prev, phone: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="Website"
              value={newSupplier.website}
              onChange={(event) =>
                setNewSupplier((prev) => ({ ...prev, website: event.target.value }))
              }
            />
            <Input
              placeholder="Default lead days"
              type="number"
              min={0}
              max={60}
              value={newSupplier.defaultLeadDays}
              onChange={(event) =>
                setNewSupplier((prev) => ({ ...prev, defaultLeadDays: event.target.value }))
              }
            />
            <Input
              placeholder="Categories (comma separated)"
              value={newSupplier.categories}
              onChange={(event) =>
                setNewSupplier((prev) => ({ ...prev, categories: event.target.value }))
              }
            />
          </div>
          <Textarea
            rows={3}
            placeholder="Notes"
            value={newSupplier.notes}
            onChange={(event) => setNewSupplier((prev) => ({ ...prev, notes: event.target.value }))}
          />
          <div className="flex justify-end">
            <Button onClick={createSupplier} disabled={savingId === "new"}>
              <Plus className="mr-2 h-4 w-4" />
              {savingId === "new" ? "Creating..." : "Add supplier"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Supplier List</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading suppliers...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suppliers configured.</p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="rounded-lg border p-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <Input
                    value={row.name}
                    onChange={(event) =>
                      setRows((prev) =>
                        prev.map((item) =>
                          item.id === row.id ? { ...item, name: event.target.value } : item
                        )
                      )
                    }
                  />
                  <Input
                    value={row.email ?? ""}
                    onChange={(event) =>
                      setRows((prev) =>
                        prev.map((item) =>
                          item.id === row.id ? { ...item, email: event.target.value } : item
                        )
                      )
                    }
                  />
                  <Input
                    value={row.phone ?? ""}
                    onChange={(event) =>
                      setRows((prev) =>
                        prev.map((item) =>
                          item.id === row.id ? { ...item, phone: event.target.value } : item
                        )
                      )
                    }
                  />
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <Input
                    value={row.website ?? ""}
                    onChange={(event) =>
                      setRows((prev) =>
                        prev.map((item) =>
                          item.id === row.id ? { ...item, website: event.target.value } : item
                        )
                      )
                    }
                  />
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    value={row.defaultLeadDays}
                    onChange={(event) =>
                      setRows((prev) =>
                        prev.map((item) =>
                          item.id === row.id
                            ? { ...item, defaultLeadDays: Number(event.target.value || 0) }
                            : item
                        )
                      )
                    }
                  />
                  <Input
                    value={row.categories.join(", ")}
                    onChange={(event) =>
                      setRows((prev) =>
                        prev.map((item) =>
                          item.id === row.id
                            ? {
                                ...item,
                                categories: event.target.value
                                  .split(",")
                                  .map((part) => part.trim())
                                  .filter(Boolean),
                              }
                            : item
                        )
                      )
                    }
                  />
                </div>
                <Textarea
                  className="mt-3"
                  rows={2}
                  value={row.notes ?? ""}
                  onChange={(event) =>
                    setRows((prev) =>
                      prev.map((item) =>
                        item.id === row.id ? { ...item, notes: event.target.value } : item
                      )
                    )
                  }
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(event) =>
                        setRows((prev) =>
                          prev.map((item) =>
                            item.id === row.id ? { ...item, isActive: event.target.checked } : item
                          )
                        )
                      }
                    />
                    Active
                  </label>
                  <Button
                    size="sm"
                    onClick={() => saveSupplier(row)}
                    disabled={savingId === row.id}
                  >
                    {savingId === row.id ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteSupplier(row.id)}
                    disabled={savingId === row.id}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
