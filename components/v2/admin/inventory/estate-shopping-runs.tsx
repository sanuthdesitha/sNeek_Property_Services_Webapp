"use client";

/**
 * ESTATE shopping runs — v2-native list of shopping runs.
 *   GET /api/admin/inventory/shopping-runs → ShoppingRun[]
 * A run's deep desk (purchase orders, receipts, client reimbursement, shopping
 * time approval — all PDF/email flows) stays in the classic inventory desk; each
 * row opens it via an EClassicLink.
 */
import { useEffect, useMemo, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { EBadge, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { EClassicLink, ETableShell } from "@/components/v2/admin/estate-kit";

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
                  <EClassicLink href="/admin/inventory?tab=shopping-runs">Open run</EClassicLink>
                </td>
              </tr>
            ))}
          </ETableShell>
        )}
      </ECard>

      <div className="flex items-center justify-between">
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          Purchase orders, receipts, reimbursements &amp; shopping-time approval live in the classic desk.
        </p>
        <EClassicLink href="/admin/inventory?tab=shopping-runs">Shopping desk</EClassicLink>
      </div>
    </div>
  );
}
