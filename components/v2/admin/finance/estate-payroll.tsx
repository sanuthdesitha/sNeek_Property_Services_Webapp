"use client";

/**
 * ESTATE payroll runs — v2-native replacement for the v1 PayrollRunsList.
 * Data is passed in from the server page (lib/payroll listPayrollRuns), and a
 * "New run" modal posts to the SAME endpoint the v1 list used:
 *   POST /api/admin/payroll/runs   { periodStart, periodEnd, cleanerId? }
 * Per-run detail links to the native Estate run desk /v2/admin/payroll/[id].
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarRange, ChevronRight, Plus, Users, Wallet } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETableShell } from "@/components/v2/admin/estate-kit";

export type EstatePayrollRun = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  grandTotal: number;
  cleanerCount: number;
  createdAt: string;
  paidCount: number;
  payoutCount: number;
};

export type EstatePayrollCleaner = { id: string; name: string };

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  CONFIRMED: "info",
  PROCESSING: "warning",
  PAID: "success",
  FAILED: "danger",
};

const money = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n ?? 0));
const fmt = (v: string) => new Date(v).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });

export function EstatePayroll({
  runs,
  cleaners,
}: {
  runs: EstatePayrollRun[];
  cleaners: EstatePayrollCleaner[];
}) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [cleanerId, setCleanerId] = useState("");
  const [creating, setCreating] = useState(false);

  const totals = useMemo(
    () => ({
      runs: runs.length,
      owing: runs
        .filter((r) => r.status !== "PAID")
        .reduce((s, r) => s + r.grandTotal, 0),
      lastRun: runs[0] ?? null,
    }),
    [runs],
  );

  async function handleCreate() {
    if (!periodStart || !periodEnd) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd, ...(cleanerId ? { cleanerId } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not create run", description: body.error, variant: "destructive" });
        return;
      }
      router.push(`/v2/admin/payroll/${body.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Total runs" value={totals.runs} icon={<CalendarRange className="h-4 w-4" />} />
        <EStatCard
          label="Owing (unpaid runs)"
          value={money(totals.owing)}
          icon={<Wallet className="h-4 w-4" />}
        />
        <EStatCard
          label="Last run"
          value={totals.lastRun ? money(totals.lastRun.grandTotal) : "—"}
          icon={<Users className="h-4 w-4" />}
          delta={totals.lastRun ? `${fmt(totals.lastRun.periodStart)} – ${fmt(totals.lastRun.periodEnd)}` : undefined}
          deltaTone="neutral"
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="e-display-sm">Payroll runs</h2>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Create a run for a period, then review and process cleaner payouts.
          </p>
        </div>
        <EButton size="sm" variant="gold" onClick={() => setShowNew(true)}>
          <Plus className="h-3.5 w-3.5" /> New run
        </EButton>
      </div>

      <ECard className="overflow-hidden p-0">
        {runs.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No payroll runs yet.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Period" },
              { label: "Cleaners", align: "center" },
              { label: "Paid", align: "center" },
              { label: "Total", align: "right" },
              { label: "Status", align: "center" },
              { label: "", align: "right" },
            ]}
          >
            {runs.map((run) => (
              <tr key={run.id} className="hover:bg-[hsl(var(--e-surface-raised))]">
                <td className="px-4 py-3">
                  <Link
                    href={`/v2/admin/payroll/${run.id}`}
                    className="font-[550] text-[hsl(var(--e-foreground))] transition-colors hover:text-[hsl(var(--e-gold-ink))]"
                  >
                    {fmt(run.periodStart)} – {fmt(run.periodEnd)}
                  </Link>
                  <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Created {fmt(run.createdAt)}</p>
                </td>
                <td className="px-4 py-3 text-center e-tnum text-[hsl(var(--e-muted-foreground))]">
                  {run.cleanerCount}
                </td>
                <td className="px-4 py-3 text-center e-tnum text-[hsl(var(--e-muted-foreground))]">
                  {run.paidCount}/{run.payoutCount}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="e-numeral text-[0.9375rem] text-[hsl(var(--e-foreground))]">
                    {money(run.grandTotal)}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <EBadge tone={STATUS_TONE[run.status] ?? "neutral"} soft>
                    {run.status}
                  </EBadge>
                </td>
                <td className="px-4 py-3 text-right">
                  <EButton asChild size="sm" variant="outline">
                    <Link href={`/v2/admin/payroll/${run.id}`}>
                      Open <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </EButton>
                </td>
              </tr>
            ))}
          </ETableShell>
        )}
      </ECard>

      <EModal open={showNew} onClose={() => setShowNew(false)} eyebrow="Workforce" title="Create payroll run">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <EField label="Period start">
              <EInput type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </EField>
            <EField label="Period end">
              <EInput type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </EField>
          </div>
          <EField label="Person" hint="Leave as Everyone to run payroll for all active cleaners.">
            <ESelect value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
              <option value="">Everyone</option>
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </ESelect>
          </EField>
          <EButton
            className="w-full"
            variant="gold"
            onClick={handleCreate}
            disabled={creating || !periodStart || !periodEnd}
          >
            {creating ? "Creating…" : cleanerId ? "Create for this person" : "Create payroll run"}
          </EButton>
        </div>
      </EModal>
    </div>
  );
}
