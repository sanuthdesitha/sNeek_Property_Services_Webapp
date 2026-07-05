"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { EstateToast } from "@/components/v2/admin/comms/toast";

type LogItem = {
  id: string;
  href?: string | null;
  subject?: string | null;
  body: string;
  createdAt: string;
  channel: string;
  status: string;
  user?: { email?: string | null } | null;
};

type Pagination = { page: number; limit: number; totalCount: number; totalPages: number; hasMore: boolean };

function statusTone(status: string): "neutral" | "warning" | "success" | "danger" {
  if (status === "FAILED") return "danger";
  if (status === "SENT") return "success";
  if (status === "PENDING") return "warning";
  return "neutral";
}

export function CommsDeliveryLog({ onToast, reloadSignal }: { onToast: (t: EstateToast) => void; reloadSignal: number }) {
  const [items, setItems] = useState<LogItem[]>([]);
  const [filters, setFilters] = useState({ q: "", channel: "all", status: "all", source: "all" });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, totalCount: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);

  const loadLog = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "50", ...filters });
    if (!filters.q.trim()) params.delete("q");
    const res = await fetch(`/api/admin/notifications/log?${params.toString()}`);
    const body = await res.json().catch(() => ({}));
    setItems(Array.isArray(body?.items) ? body.items : []);
    setPagination(body?.pagination ?? { page: 1, limit: 50, totalCount: 0, totalPages: 1, hasMore: false });
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { loadLog(); }, [loadLog, reloadSignal]);
  useEffect(() => { setPage(1); }, [filters.channel, filters.status, filters.source, filters.q]);

  return (
    <div className="space-y-6">
      <ECard>
        <ECardBody className="grid gap-3 p-4 md:grid-cols-[1.6fr_160px_160px_160px_auto]">
          <EField label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-muted-foreground))]" />
              <EInput className="pl-9" value={filters.q} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Subject, body, user, or email" />
            </div>
          </EField>
          <EField label="Source">
            <ESelect value={filters.source} onChange={(e) => setFilters((p) => ({ ...p, source: e.target.value }))}>
              <option value="all">All sources</option>
              <option value="notification">Notifications</option>
              <option value="audit">Audit only</option>
            </ESelect>
          </EField>
          <EField label="Channel">
            <ESelect value={filters.channel} onChange={(e) => setFilters((p) => ({ ...p, channel: e.target.value }))}>
              <option value="all">All channels</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="PUSH">Push</option>
              <option value="AUDIT">Audit</option>
            </ESelect>
          </EField>
          <EField label="Status">
            <ESelect value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
              <option value="all">All statuses</option>
              <option value="SENT">Sent</option>
              <option value="PENDING">Pending</option>
              <option value="FAILED">Failed</option>
            </ESelect>
          </EField>
          <div className="flex items-end">
            <EButton variant="ghost" onClick={() => setFilters({ q: "", channel: "all", status: "all", source: "all" })}>Clear</EButton>
          </div>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardBody className="p-0">
          {loading ? (
            <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading notifications…</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No notifications found.</p>
          ) : (
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {items.map((item) => (
                <div key={item.id} className="px-5 py-3 transition-colors hover:bg-[hsl(var(--e-muted)/0.4)]">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-[0.875rem] font-medium text-[hsl(var(--e-foreground))]">{item.subject ?? "Notification"}</p>
                      <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.body}</p>
                      <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                        {new Date(item.createdAt).toLocaleString("en-AU")}{item.user?.email ? ` | ${item.user.email}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <EBadge tone="neutral">{item.channel}</EBadge>
                      <EBadge tone={statusTone(item.status)} soft>{item.status}</EBadge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>

      <div className="flex items-center justify-between rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Page {pagination.page} of {pagination.totalPages} • {pagination.totalCount} matching items
        </p>
        <div className="flex items-center gap-2">
          <EButton variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((c) => Math.max(1, c - 1))}><ChevronLeft className="h-4 w-4" />Previous</EButton>
          <EButton variant="outline" size="sm" disabled={!pagination.hasMore} onClick={() => setPage((c) => c + 1)}>Next<ChevronRight className="h-4 w-4" /></EButton>
        </div>
      </div>
    </div>
  );
}
