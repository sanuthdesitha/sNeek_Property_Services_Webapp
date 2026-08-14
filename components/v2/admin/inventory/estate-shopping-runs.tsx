"use client";

/**
 * ESTATE shopping runs — v2-native list of shopping runs.
 *   GET /api/admin/inventory/shopping-runs → ShoppingRun[]
 * Each row opens the native Estate run desk at /v2/admin/inventory/shopping/[id]
 * (purchase orders, receipts, client reimbursement, shopping-time approval).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Layers, ShoppingCart } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { EField, ESelect, ETableShell } from "@/components/v2/admin/estate-kit";
import {
  DEFAULT_SHOPPING_GROUP_MODE,
  SHOPPING_GROUP_MODES,
  SHOPPING_GROUP_MODE_LABELS,
  normalizeShoppingGroupMode,
  type ShoppingGroupMode,
} from "@/lib/inventory/shopping-grouping";

type RunStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";
type ShoppingRun = {
  id: string;
  name: string;
  status: RunStatus;
  ownerScope: "CLIENT" | "CLEANER";
  ownerName: string;
  planningScope: string;
  updatedAt: string;
  clientChargeStatus: "NOT_REQUIRED" | "READY" | "SENT" | "PAID";
  cleanerReimbursementStatus: "NOT_APPLICABLE" | "READY" | "INVOICED" | "REIMBURSED";
  totals: { includedLineCount: number; estimatedTotalCost: number; actualTotalCost: number };
};

const STATUS_TONE: Record<RunStatus, "neutral" | "info" | "success"> = {
  DRAFT: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
};
const statusLabel = (s: RunStatus) => (s === "IN_PROGRESS" ? "Active" : s === "COMPLETED" ? "Submitted" : "Draft");
const money = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n ?? 0));
const fmt = (v: string) => new Date(v).toLocaleDateString("en-AU", { day: "2-digit", month: "short" });

export function EstateShoppingRuns() {
  const [runs, setRuns] = useState<ShoppingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupMode, setGroupMode] = useState<ShoppingGroupMode>(DEFAULT_SHOPPING_GROUP_MODE);
  const [savingGroupMode, setSavingGroupMode] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/inventory/shopping-runs");
        const body = await res.json().catch(() => []);
        setRuns(Array.isArray(body) ? body : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/inventory/settings", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));
      setGroupMode(normalizeShoppingGroupMode(body?.shoppingGroupMode));
    })();
  }, []);

  async function saveGroupMode(next: ShoppingGroupMode) {
    const previous = groupMode;
    setGroupMode(next);
    setSavingGroupMode(true);
    try {
      const res = await fetch("/api/admin/inventory/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shoppingGroupMode: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGroupMode(previous);
        toast({ title: "Could not save grouping", description: body.error, variant: "destructive" });
        return;
      }
      setGroupMode(normalizeShoppingGroupMode(body?.shoppingGroupMode));
      toast({ title: `Shopping runs now open ${SHOPPING_GROUP_MODE_LABELS[next].toLowerCase()}` });
    } finally {
      setSavingGroupMode(false);
    }
  }

  const totals = useMemo(
    () => ({
      open: runs.filter((r) => r.status !== "COMPLETED").length,
      value: runs.reduce((s, r) => s + (r.totals?.estimatedTotalCost ?? 0), 0),
    }),
    [runs],
  );

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-4 sm:max-w-md">
        <EStatCard label="Open runs" value={totals.open} icon={<ShoppingCart className="h-4 w-4" />} />
        <EStatCard label="Estimated value" value={money(totals.value)} icon={<ShoppingCart className="h-4 w-4" />} />
      </section>

      {/* Run settings — the DEFAULT grouping every shopping run opens with.
          Shoppers can still switch on the run itself; this sets the starting
          point so a team that always shops supplier-by-supplier never has to. */}
      <ECard className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
          <h2 className="text-[0.9375rem] font-[600] text-[hsl(var(--e-foreground))]">Shopping run settings</h2>
        </div>
        <div className="grid gap-3 sm:max-w-md">
          <EField
            label="Default grouping"
            hint="How a shopping run is bundled when it opens. Shoppers can change it per run."
          >
            <ESelect
              className="h-9"
              value={groupMode}
              disabled={savingGroupMode}
              onChange={(e) => void saveGroupMode(normalizeShoppingGroupMode(e.target.value))}
            >
              {SHOPPING_GROUP_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {SHOPPING_GROUP_MODE_LABELS[mode]}
                </option>
              ))}
            </ESelect>
          </EField>
        </div>
      </ECard>

      <ECard className="overflow-hidden p-0">
        {loading ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No shopping runs.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Run" },
              { label: "Owner" },
              { label: "Lines", align: "center" },
              { label: "Est. cost", align: "right" },
              { label: "Status", align: "center" },
              { label: "", align: "right" },
            ]}
          >
            {runs.map((run) => (
              <tr key={run.id} className="hover:bg-[hsl(var(--e-surface-raised))]">
                <td className="px-4 py-3">
                  <span className="font-[550] text-[hsl(var(--e-foreground))]">{run.name}</span>
                  <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                    {run.planningScope} · {fmt(run.updatedAt)}
                  </p>
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {run.ownerName}
                  <span className="text-[hsl(var(--e-text-faint))]"> · {run.ownerScope.toLowerCase()}</span>
                </td>
                <td className="px-4 py-3 text-center e-tnum text-[hsl(var(--e-muted-foreground))]">
                  {run.totals?.includedLineCount ?? 0}
                </td>
                <td className="px-4 py-3 text-right e-numeral text-[hsl(var(--e-foreground))]">
                  {money(run.totals?.estimatedTotalCost ?? 0)}
                </td>
                <td className="px-4 py-3 text-center">
                  <EBadge tone={STATUS_TONE[run.status]} soft>
                    {statusLabel(run.status)}
                  </EBadge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/v2/admin/inventory/shopping/${run.id}`}
                    className="inline-flex items-center gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline"
                  >
                    Open run <ArrowRight className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </ETableShell>
        )}
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Open a run for its purchase order, receipts, reimbursements &amp; shopping-time approval.
      </p>
    </div>
  );
}
