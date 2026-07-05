"use client";

/**
 * ESTATE v2 — QA queue workspace.
 *
 * Native Estate rebuild of the QA queue. Same endpoints as v1:
 *   GET  /api/qa/queue?scope=active|completed
 *   POST /api/qa/jobs/[id]/pickup
 *   POST /api/admin/qa/assignments   (bulk assign — OPS/ADMIN only)
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Inbox, Loader2, RefreshCw, UserCheck, UserPlus, ChevronRight, Search } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState, EStatCard } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";

type Inspector = { id: string; name: string | null; email: string; role: string };
type Toast = { id: string; title: string; description?: string; tone: "info" | "danger" };

function titleCase(value: string): string {
  return String(value)
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function jobTitle(job: any) {
  return `${job?.property?.name ?? "Property"} — ${titleCase(String(job?.jobType ?? "Job"))}`;
}
function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "COMPLETED") return "success";
  if (status === "QA_REVIEW") return "warning";
  return "neutral";
}

export function QaQueueWorkspace({ inspectors, canAssign = false }: { inspectors: Inspector[]; canAssign?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({ assignments: [], unassignedJobs: [] });
  const [scope, setScope] = useState<"active" | "completed">("active");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedInspector, setSelectedInspector] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/qa/queue?scope=${scope}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      pushToast({ title: "Could not load QA queue", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    setData(body);
  }, [scope, pushToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const assigned = (data.assignments ?? []).map((a: any) => ({ key: a.id, jobId: a.jobId, assignment: a, job: a.job, assigned: true }));
    const unassigned = (data.unassignedJobs ?? []).map((j: any) => ({ key: `job-${j.id}`, jobId: j.id, assignment: null, job: j, assigned: false }));
    return [...assigned, ...unassigned];
  }, [data]);

  const jobTypeOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.job?.jobType && set.add(String(r.job.jobType)));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const job = row.job ?? {};
      if (typeFilter !== "all" && String(job.jobType) !== typeFilter) return false;
      if (q) {
        const hay = [job.property?.name, job.property?.address, job.property?.suburb, titleCase(String(job.jobType ?? ""))]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, typeFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const unassigned = rows.filter((r) => !r.assigned).length;
    const inProgress = rows.filter((r) => r.assignment?.pickedUpById || r.assignment?.status === "IN_PROGRESS").length;
    const assigned = Math.max(0, total - unassigned - inProgress);
    return { total, unassigned, assigned, inProgress };
  }, [rows]);

  async function bulkAssign() {
    if (!selectedInspector || selectedJobs.length === 0) return;
    const res = await fetch("/api/admin/qa/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds: selectedJobs, assignedToId: selectedInspector }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushToast({ title: "QA assignment failed", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    pushToast({ title: "QA assigned", description: `${body.created ?? selectedJobs.length} job(s) assigned.`, tone: "info" });
    setSelectedJobs([]);
    await load();
  }

  async function pickup(jobId: string) {
    const res = await fetch(`/api/qa/jobs/${jobId}/pickup`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushToast({ title: "Could not pick up QA", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    pushToast({ title: "QA picked up", tone: "info" });
    await load();
  }

  return (
    <div className="space-y-6">
      {toasts.length > 0 ? (
        <div className="fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="w-full max-w-sm rounded-[var(--e-radius-lg)] border px-4 py-3 shadow-[var(--e-elevation-2)]"
              style={{
                backgroundColor: t.tone === "danger" ? "hsl(var(--e-danger-soft))" : "hsl(var(--e-surface))",
                borderColor: t.tone === "danger" ? "hsl(var(--e-danger))" : "hsl(var(--e-border-strong))",
              }}
            >
              <p className="text-[0.8125rem] font-semibold">{t.title}</p>
              {t.description ? <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{t.description}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* scope toggle + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-0.5">
          {(["active", "completed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className="rounded-[var(--e-radius-pill)] px-4 py-1.5 text-[0.8125rem] font-[550] transition-colors"
              style={{
                backgroundColor: scope === s ? "hsl(var(--e-gold))" : "transparent",
                color: scope === s ? "hsl(var(--e-gold-foreground))" : "hsl(var(--e-muted-foreground))",
              }}
            >
              {s === "active" ? "To inspect" : "Submitted"}
            </button>
          ))}
        </div>
        <EButton variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
        </EButton>
      </div>

      {!loading ? (
        <section className="grid gap-4 sm:grid-cols-4">
          <EStatCard label="In queue" value={String(stats.total)} delta="total" deltaTone="neutral" icon={<Inbox className="h-4 w-4" />} />
          <EStatCard label="Unassigned" value={String(stats.unassigned)} delta="unpicked" deltaTone="neutral" icon={<ClipboardCheck className="h-4 w-4" />} />
          <EStatCard label="Assigned" value={String(stats.assigned)} delta="waiting" deltaTone="neutral" icon={<UserCheck className="h-4 w-4" />} />
          <EStatCard label="In progress" value={String(stats.inProgress)} delta="being inspected" deltaTone="neutral" icon={<Loader2 className="h-4 w-4" />} />
        </section>
      ) : null}

      {canAssign ? (
        <ECard>
          <ECardBody className="grid gap-3 pt-6 sm:grid-cols-[1fr_auto]">
            <ESelect value={selectedInspector} onChange={(e) => setSelectedInspector(e.target.value)}>
              <option value="">Select QA inspector or OPS manager</option>
              {inspectors.map((i) => (
                <option key={i.id} value={i.id}>{(i.name || i.email) + ` (${titleCase(i.role)})`}</option>
              ))}
            </ESelect>
            <EButton onClick={() => void bulkAssign()} disabled={!selectedInspector || selectedJobs.length === 0}>
              <UserPlus className="h-4 w-4" /> Assign {selectedJobs.length || ""}
            </EButton>
          </ECardBody>
        </ECard>
      ) : null}

      {/* filters */}
      <ECard>
        <ECardBody className="grid gap-2 pt-6 sm:grid-cols-[1fr_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
            <EInput className="pl-9" placeholder="Search property…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ESelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {jobTypeOptions.map((t) => (
              <option key={t} value={t}>{titleCase(t)}</option>
            ))}
          </ESelect>
        </ECardBody>
      </ECard>

      {/* list */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-6 py-12 text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
          </div>
        ) : rows.length === 0 ? (
          <EEmptyState eyebrow="All clear" title="No jobs waiting" description="Every submitted job has been reviewed." />
        ) : filtered.length === 0 ? (
          <EEmptyState eyebrow="No match" title="Nothing matches these filters" />
        ) : (
          filtered.map((row) => (
            <ECard key={row.key}>
              <ECardBody className="flex flex-wrap items-center gap-3 pt-6">
                {canAssign && !row.assigned ? (
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                    checked={selectedJobs.includes(row.jobId)}
                    onChange={(e) => setSelectedJobs((prev) => (e.target.checked ? [...prev, row.jobId] : prev.filter((id) => id !== row.jobId)))}
                    aria-label={`Select ${jobTitle(row.job)}`}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[0.9375rem] font-medium">{jobTitle(row.job)}</p>
                    <EBadge tone={statusTone(row.job?.status)} soft>{titleCase(String(row.job?.status ?? ""))}</EBadge>
                    <EBadge tone={row.assigned ? "info" : "neutral"} soft>
                      {row.assigned ? titleCase(String(row.assignment.status)) : "Unassigned"}
                    </EBadge>
                  </div>
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {[row.job?.property?.address, row.job?.property?.suburb].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    Cleaner: {row.job?.assignments?.map((a: any) => a.user?.name || a.user?.email).join(", ") || "N/A"}
                    {row.assignment?.assignedTo ? ` · Assigned to ${row.assignment.assignedTo.name || row.assignment.assignedTo.email}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!row.assignment?.pickedUpById && scope === "active" ? (
                    <EButton variant="outline" size="sm" onClick={() => void pickup(row.jobId)}>
                      <ClipboardCheck className="h-4 w-4" /> Pick up
                    </EButton>
                  ) : null}
                  <EButton asChild variant="gold" size="sm">
                    <Link href={`/v2/qa/jobs/${row.jobId}`}>
                      {row.assignment?.status === "IN_PROGRESS" ? "Continue" : "Open"}
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </EButton>
                </div>
              </ECardBody>
            </ECard>
          ))
        )}
      </div>
    </div>
  );
}
