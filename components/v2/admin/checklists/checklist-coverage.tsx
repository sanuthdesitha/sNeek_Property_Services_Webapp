"use client";

/**
 * ESTATE — Checklist coverage (native v2 port of app/admin/checklists/coverage).
 * Bulk rollout assistant: every active property with its checklist status,
 * bulk-generate default DRAFT profiles, links to the per-property builder, and
 * mints client-facing amenities survey links.
 *
 * Endpoints (unchanged from v1):
 *   GET   /api/admin/checklist-coverage                          → { properties }
 *   POST  /api/admin/checklist-coverage           { propertyIds }→ { created, skipped }
 *   POST  /api/admin/properties/:id/amenities-link              → { url }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Link2, Loader2, RefreshCw, Wand2 } from "lucide-react";
import { EButton, ECard, EBadge, EAlert } from "@/components/v2/ui/primitives";
import { EInput, ETableShell, ESwitch } from "@/components/v2/admin/estate-kit";

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
      return (
        <EBadge tone="success" soft>
          Approved
        </EBadge>
      );
    case "DRAFT":
      return (
        <EBadge tone="warning" soft>
          Draft
        </EBadge>
      );
    case "STALE":
      return (
        <EBadge tone="warning" soft>
          Needs review
        </EBadge>
      );
    default:
      return <EBadge tone="neutral">Not set up</EBadge>;
  }
}

export function EstateChecklistCoverage() {
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Could not load coverage.");
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
  const allFilteredChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      allFilteredChecked ? new Set() : new Set(filtered.map((r) => r.id))
    );
  };

  const generateDefaults = async (propertyIds: string[]) => {
    if (propertyIds.length === 0) return;
    setGenerating(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/checklist-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not generate.");
      setNotice(
        `${body.created} draft checklist(s) created, ${body.skipped} skipped (already set up). Review + approve each from the property's Forms tab.`
      );
      setSelected(new Set());
      await load();
    } catch (err: any) {
      setError(err.message ?? "Could not generate.");
    } finally {
      setGenerating(false);
    }
  };

  const copyClientLink = async (propertyId: string) => {
    setLinkBusy(propertyId);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/amenities-link`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create link.");
      await navigator.clipboard.writeText(body.url);
      setNotice("Client amenities survey link copied. Send it to the client — valid 14 days.");
    } catch (err: any) {
      setError(err.message ?? "Could not create link.");
    } finally {
      setLinkBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <EAlert tone="danger" title="Something went wrong">
          {error}
        </EAlert>
      ) : null}
      {notice ? (
        <EAlert tone="success" title="Done">
          {notice}
        </EAlert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          {rows.length} properties · {missing.length} without a checklist yet.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <EButton variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </EButton>
          <EButton
            size="sm"
            variant="outline"
            onClick={() => void generateDefaults(missing.map((row) => row.id))}
            disabled={generating || missing.length === 0}
          >
            {generating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="mr-1 h-3.5 w-3.5" />
            )}
            Generate for all missing ({missing.length})
          </EButton>
          <EButton
            size="sm"
            onClick={() => void generateDefaults(Array.from(selected))}
            disabled={generating || selected.size === 0}
          >
            {generating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="mr-1 h-3.5 w-3.5" />
            )}
            Generate for selected ({selected.size})
          </EButton>
        </div>
      </div>

      <ECard>
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <span className="text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">Properties</span>
          <EInput
            placeholder="Search property / suburb / client…"
            className="h-9 w-64"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {loading ? (
          <p className="px-4 py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No properties found.
          </p>
        ) : (
          <ETableShell
            className="border-t border-[hsl(var(--e-border))]"
            headers={[
              {
                label: (
                  <ESwitch checked={allFilteredChecked} onCheckedChange={toggleAll} />
                ),
                className: "w-10",
              },
              { label: "Property" },
              { label: "Client" },
              { label: "Layout" },
              { label: "Amenities" },
              { label: "Checklist" },
              { label: "", align: "right" },
            ]}
          >
            {filtered.map((row) => (
              <tr key={row.id} className="hover:bg-[hsl(var(--e-muted))]">
                <td className="px-4 py-2.5">
                  <ESwitch checked={selected.has(row.id)} onCheckedChange={() => toggleSelect(row.id)} />
                </td>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-[hsl(var(--e-foreground))]">{row.name}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.suburb}</p>
                </td>
                <td className="px-4 py-2.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  {row.clientName}
                </td>
                <td className="px-4 py-2.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {row.bedrooms}bd · {row.bathrooms}ba{row.hasBalcony ? " · balcony" : ""}
                </td>
                <td className="px-4 py-2.5">
                  {row.hasFeatures ? (
                    <EBadge tone="info" soft>
                      Captured
                    </EBadge>
                  ) : (
                    <EBadge tone="neutral">Unknown</EBadge>
                  )}
                </td>
                <td className="px-4 py-2.5">{statusBadge(row.checklistStatus)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <EButton
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => void copyClientLink(row.id)}
                      disabled={linkBusy === row.id}
                      title="Copy a client-facing amenities survey link"
                    >
                      {linkBusy === row.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1 hidden sm:inline">Client link</span>
                    </EButton>
                    <EButton size="sm" variant="outline" className="h-8 px-2" asChild>
                      <Link href={`/v2/admin/properties/${row.id}`}>Open builder</Link>
                    </EButton>
                  </div>
                </td>
              </tr>
            ))}
          </ETableShell>
        )}
      </ECard>
    </div>
  );
}
