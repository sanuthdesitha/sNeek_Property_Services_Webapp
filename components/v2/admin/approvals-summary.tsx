"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  RefreshCw,
  RotateCcw,
  Shirt,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";

// Same category keys the legacy Approvals Centre uses; counts come straight from
// /api/admin/all-approvals (the exact legacy data source — never forked).
const CATEGORIES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "continuations", label: "Job Continuations", icon: RefreshCw },
  { key: "timingRequests", label: "Timing Requests", icon: Clock },
  { key: "payAdjustments", label: "Pay Requests", icon: DollarSign },
  { key: "timeAdjustments", label: "Clock Adjustments", icon: Clock },
  { key: "clientApprovals", label: "Client Approvals", icon: CheckCircle2 },
  { key: "flaggedLaundry", label: "Flagged Laundry", icon: Shirt },
  { key: "rescheduleRequests", label: "Reschedule Requests", icon: CalendarClock },
  { key: "qaReworkTransfers", label: "QA Reworks", icon: RotateCcw },
  { key: "skipRequests", label: "Skip Requests", icon: XCircle },
];

type AllApprovals = { counts: Record<string, number> };

export function ApprovalsSummary() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/admin/all-approvals");
      const body = (await res.json().catch(() => null)) as AllApprovals | null;
      if (res.ok && body) setCounts(body.counts ?? {});
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const total = counts?.total ?? 0;
  const withItems = CATEGORIES.filter((c) => (counts?.[c.key] ?? 0) > 0);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Approvals"
        title="Approvals Centre"
        description="All pending requests across jobs, pay, laundry, and client approvals in one place."
        actions={
          <>
            {total > 0 ? <EBadge tone="danger" soft>{total} pending</EBadge> : null}
            <EButton variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} /> Refresh
            </EButton>
            <Link href="/admin/approvals">
              <EButton variant="primary" size="sm">Open full centre <ArrowRight className="h-3.5 w-3.5" /></EButton>
            </Link>
          </>
        }
      />

      {loading && !counts ? (
        <div className="py-16 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading…</div>
      ) : failed && !counts ? (
        <ECard>
          <ECardBody className="flex flex-col items-center gap-3 py-14 text-center">
            <AlertTriangle className="h-6 w-6 text-[hsl(var(--e-warning))]" />
            <p className="text-[0.875rem]">Couldn&apos;t load approvals.</p>
            <EButton variant="outline" size="sm" onClick={load}>Retry</EButton>
          </ECardBody>
        </ECard>
      ) : total === 0 ? (
        <EEmptyState
          eyebrow="All clear"
          title="No pending approvals"
          description="Every request queue is caught up. New items will appear here."
          action={
            <Link href="/admin/approvals">
              <EButton variant="outline" size="sm">Open full centre</EButton>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {withItems.map(({ key, label, icon: Icon }) => {
            const count = counts?.[key] ?? 0;
            return (
              <Link key={key} href="/admin/approvals" className="block">
                <ECard className="transition-shadow hover:shadow-[var(--e-elevation-1)]">
                  <ECardBody className="flex items-center justify-between gap-4 p-5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-[0.875rem] font-[550]">{label}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {count} pending {count === 1 ? "item" : "items"}
                        </p>
                      </div>
                    </div>
                    <EBadge tone="danger" soft>{count}</EBadge>
                  </ECardBody>
                </ECard>
              </Link>
            );
          })}
        </div>
      )}

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · live counts from your workspace. Approve, decline, and send-to-client actions open in the full Approvals Centre.
      </p>
    </div>
  );
}
