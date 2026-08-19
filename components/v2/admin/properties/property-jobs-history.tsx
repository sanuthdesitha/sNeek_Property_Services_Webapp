"use client";

/**
 * Jobs & history tab for the v2 property workspace — Estate-native port of
 * v1's components/admin/property-jobs-tab.tsx against the same
 * GET /api/admin/properties/:id/jobs feed ({ jobs, stats }).
 *
 * Carries the v1 capabilities the first v2 cut dropped:
 *  - status filter chips (all / completed / upcoming / with issues)
 *  - per-job report download (GET /api/reports/:jobId/download)
 *  - deep link to the job's forms tab (v1 ?tab=submission → v2 ?tab=forms)
 *  - property-scoped quick links to Cases / Maintenance / Reports / Laundry.
 *    The v2 list workspaces keep their filters in client state and do not read
 *    ?propertyId=, so these links land unfiltered — still one click closer
 *    than the sidebar.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  Download,
  ExternalLink,
  FileText,
  Shirt,
  Wrench,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";
import { jobDetailTabHref } from "@/lib/jobs/detail-tabs";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";

type PropertyJob = {
  id: string;
  jobNumber: string | null;
  jobType: string;
  status: string;
  scheduledDate: string | null;
  startTime: string | null;
  skipped: boolean;
  cleaners: string[];
  qa: { score: number; passed: boolean } | null;
  hasForm: boolean;
  laundryOutcome: string | null;
  hasReport: boolean;
  issueCount: number;
  maintenanceCount: number;
};

type PropertyJobStats = {
  total: number;
  completed: number;
  upcoming: number;
  skipped: number;
};

type JobFilter = "all" | "completed" | "upcoming" | "issues";

const COMPLETED_STATUSES = new Set(["COMPLETED", "INVOICED"]);

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  UNASSIGNED: "warning",
  OFFERED: "warning",
  ASSIGNED: "info",
  EN_ROUTE: "warning",
  IN_PROGRESS: "info",
  PAUSED: "warning",
  WAITING_CONTINUATION_APPROVAL: "danger",
  SUBMITTED: "info",
  QA_REVIEW: "warning",
  COMPLETED: "success",
  INVOICED: "neutral",
  CANCELLED: "danger",
};

function titleCase(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Estate quick links to the other property-adjacent workspaces. */
const QUICK_LINKS: Array<{ href: string; label: string; icon: React.ReactNode }> = [
  { href: "/v2/admin/cases", label: "Damage cases", icon: <AlertTriangle className="mr-1 h-3.5 w-3.5" /> },
  { href: "/v2/admin/maintenance", label: "Maintenance", icon: <Wrench className="mr-1 h-3.5 w-3.5" /> },
  { href: "/v2/admin/reports", label: "Reports", icon: <FileText className="mr-1 h-3.5 w-3.5" /> },
  { href: "/v2/admin/laundry", label: "Laundry", icon: <Shirt className="mr-1 h-3.5 w-3.5" /> },
];

export function PropertyJobsHistory({ propertyId }: { propertyId: string }) {
  const [jobs, setJobs] = useState<PropertyJob[] | null>(null);
  const [stats, setStats] = useState<PropertyJobStats | null>(null);
  const [filter, setFilter] = useState<JobFilter>("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/properties/${propertyId}/jobs`)
      .then(async (r): Promise<unknown> => (r.ok ? await r.json() : {}))
      .then((raw) => {
        const data = (Array.isArray(raw) ? { jobs: raw } : (raw ?? {})) as {
          jobs?: unknown;
          stats?: PropertyJobStats;
        };
        if (cancelled) return;
        // The feed returns { jobs, stats }; tolerate a bare array so an older
        // deployment of the API can't blank the tab.
        setJobs(Array.isArray(data.jobs) ? (data.jobs as PropertyJob[]) : []);
        setStats(data.stats ?? null);
      })
      .catch(() => {
        if (!cancelled) setJobs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  async function downloadReport(jobId: string) {
    setDownloadingId(jobId);
    try {
      await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
    } catch {
      toast({ title: "Download failed", description: "Could not download the report.", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }

  if (jobs === null) {
    return (
      <ECard>
        <ECardBody className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading jobs…
        </ECardBody>
      </ECard>
    );
  }

  const issueJobs = jobs.filter((j) => j.issueCount > 0 || j.maintenanceCount > 0);
  const visibleJobs = jobs.filter((j) => {
    if (filter === "completed") return COMPLETED_STATUSES.has(j.status);
    if (filter === "upcoming") return !COMPLETED_STATUSES.has(j.status) && j.status !== "CANCELLED" && !j.skipped;
    if (filter === "issues") return j.issueCount > 0 || j.maintenanceCount > 0;
    return true;
  });

  const chips: Array<{ key: JobFilter; label: string; count: number }> = [
    { key: "all", label: "All", count: jobs.length },
    { key: "completed", label: "Completed", count: stats?.completed ?? jobs.filter((j) => COMPLETED_STATUSES.has(j.status)).length },
    { key: "upcoming", label: "Upcoming", count: stats?.upcoming ?? 0 },
    { key: "issues", label: "With issues", count: issueJobs.length },
  ];

  return (
    <div className="space-y-4">
      {/* Quick navigation to property-adjacent workspaces */}
      <div className="flex flex-wrap gap-2">
        {QUICK_LINKS.map((link) => (
          <EButton key={link.href} asChild variant="outline" size="sm">
            <Link href={link.href}>
              {link.icon}
              {link.label}
            </Link>
          </EButton>
        ))}
      </div>

      <ECard>
        <ECardHeader className="pb-2">
          <ECardTitle className="text-[0.95rem]">Jobs &amp; history</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          {/* Status filter chips — client-side over the loaded feed */}
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key)}
                aria-pressed={filter === chip.key}
                className={
                  "inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.75rem] font-[550] transition-colors duration-[160ms] " +
                  (filter === chip.key
                    ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                    : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-surface-raised))]")
                }
              >
                {chip.label}
                <span className="e-tnum">{chip.count}</span>
              </button>
            ))}
          </div>

          {visibleJobs.length === 0 ? (
            <EEmptyState
              eyebrow="No jobs"
              title={jobs.length === 0 ? "Nothing scheduled yet" : "No jobs match this filter"}
              description={
                jobs.length === 0
                  ? "This property's jobs will appear here."
                  : "Try another filter chip above."
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Date", "Job", "Service", "Status", "Signals", ""].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((j) => (
                    <tr
                      key={j.id}
                      className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]"
                    >
                      <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                        {j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString("en-AU") : "—"}
                        {j.startTime ? (
                          <span className="text-[hsl(var(--e-text-faint))]"> · {j.startTime}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p className="font-[550]">{j.jobNumber ?? j.id.slice(0, 8)}</p>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {j.cleaners.length > 0 ? j.cleaners.join(", ") : "Unassigned"}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-[hsl(var(--e-text-secondary))]">
                        {titleCase(j.jobType)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <EBadge tone={STATUS_TONE[j.status] ?? "neutral"} soft>
                          {titleCase(j.status)}
                        </EBadge>
                        {j.skipped ? (
                          <EBadge tone="danger" soft className="ml-1">
                            Skipped
                          </EBadge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1">
                          {j.qa ? (
                            <EBadge tone={j.qa.passed ? "success" : "danger"} soft>
                              QA {j.qa.score}%
                            </EBadge>
                          ) : null}
                          {j.issueCount > 0 ? (
                            <EBadge tone="danger" soft>
                              {j.issueCount} damage
                            </EBadge>
                          ) : null}
                          {j.maintenanceCount > 0 ? (
                            <EBadge tone="warning" soft>
                              {j.maintenanceCount} to fix
                            </EBadge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <EButton asChild variant="ghost" size="sm">
                            <Link href={`/v2/admin/jobs/${j.id}`}>
                              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                            </Link>
                          </EButton>
                          {/* v1's ?tab=submission deep link → the v2 job page's
                              "forms" tab (lib/jobs/detail-tabs). Only shown when
                              a submission exists — the tab is empty otherwise. */}
                          {j.hasForm ? (
                            <EButton asChild variant="ghost" size="sm">
                              <Link href={jobDetailTabHref(j.id, "forms")}>
                                <Camera className="mr-1 h-3.5 w-3.5" /> Forms
                              </Link>
                            </EButton>
                          ) : null}
                          {j.hasReport ? (
                            <EButton
                              variant="ghost"
                              size="sm"
                              disabled={downloadingId === j.id}
                              onClick={() => downloadReport(j.id)}
                            >
                              <Download className="mr-1 h-3.5 w-3.5" />
                              {downloadingId === j.id ? "Fetching…" : "Report"}
                            </EButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
