"use client";

/**
 * Checklist coverage — bulk rollout assistant for existing properties.
 * Shows every active property with its checklist status, bulk-generates
 * default DRAFT profiles from each property's attributes, links to the
 * per-property builder, and mints client-facing amenities survey links.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { ClipboardCheck, Link2, Loader2, RefreshCw, Wand2 } from "lucide-react";

interface CoverageRow {
  id: string;
  name: string;
  suburb: string;
  clientName: string;
  bedrooms: number;
  bathrooms: number;
  hasBalcony: boolean;
  hasFeatures: boolean;
  checklistStatus: "NONE" | "DRAFT" | "APPROVED" | "STALE" | string;
  approvedAt: string | null;
}

function statusBadge(status: string) {
  switch (status) {
    case "APPROVED":
      return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Approved</Badge>;
    case "DRAFT":
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Draft</Badge>;
    case "STALE":
      return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Needs review</Badge>;
    default:
      return <Badge variant="outline">Not set up</Badge>;
  }
}

export default function ChecklistCoveragePage() {
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/checklist-coverage", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load coverage.");
      setRows(body.properties ?? []);
    } catch (err: any) {
      toast({ title: "Load failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(query) ||
        row.suburb.toLowerCase().includes(query) ||
        row.clientName.toLowerCase().includes(query)
    );
  }, [rows, search]);

  const missing = useMemo(() => rows.filter((row) => row.checklistStatus === "NONE"), [rows]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generateDefaults = async (propertyIds: string[]) => {
    if (propertyIds.length === 0) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/checklist-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not generate.");
      toast({
        title: "Draft checklists generated",
        description: `${body.created} created, ${body.skipped} skipped (already set up). Review + approve each from the property's Forms tab.`,
      });
      setSelected(new Set());
      await load();
    } catch (err: any) {
      toast({ title: "Generate failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const copyClientLink = async (propertyId: string) => {
    setLinkBusy(propertyId);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/amenities-link`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create link.");
      await navigator.clipboard.writeText(body.url);
      toast({ title: "Client link copied", description: "Send it to the client to fill in the property's amenities. Valid 14 days." });
    } catch (err: any) {
      toast({ title: "Link failed", description: err.message, variant: "destructive" });
    } finally {
      setLinkBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" /> Checklist coverage
          </h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} properties · {missing.length} without a checklist yet.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateDefaults(missing.map((row) => row.id))}
            disabled={generating || missing.length === 0}
          >
            {generating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
            Generate defaults for all missing ({missing.length})
          </Button>
          <Button
            size="sm"
            onClick={() => generateDefaults(Array.from(selected))}
            disabled={generating || selected.size === 0}
          >
            {generating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
            Generate for selected ({selected.size})
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">Properties</CardTitle>
            <Input
              placeholder="Search property / suburb / client…"
              className="h-8 w-64"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No properties found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-8 pb-2" />
                    <th className="pb-2 pr-3">Property</th>
                    <th className="pb-2 pr-3">Client</th>
                    <th className="pb-2 pr-3">Layout</th>
                    <th className="pb-2 pr-3">Amenities</th>
                    <th className="pb-2 pr-3">Checklist</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 pr-2">
                        <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleSelect(row.id)} />
                      </td>
                      <td className="py-2 pr-3">
                        <p className="font-medium">{row.name}</p>
                        <p className="text-xs text-muted-foreground">{row.suburb}</p>
                      </td>
                      <td className="py-2 pr-3 text-xs">{row.clientName}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {row.bedrooms}bd · {row.bathrooms}ba{row.hasBalcony ? " · balcony" : ""}
                      </td>
                      <td className="py-2 pr-3">
                        {row.hasFeatures ? (
                          <Badge variant="outline" className="text-[10px]">Captured</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">Unknown</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3">{statusBadge(row.checklistStatus)}</td>
                      <td className="py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => copyClientLink(row.id)}
                            disabled={linkBusy === row.id}
                            title="Copy a client-facing amenities survey link"
                          >
                            {linkBusy === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Link2 className="h-3.5 w-3.5" />
                            )}
                            <span className="ml-1 hidden sm:inline">Client link</span>
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" asChild>
                            <Link href={`/admin/properties/${row.id}?tab=forms`}>Open builder</Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
