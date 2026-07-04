import Link from "next/link";
import { format } from "date-fns";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EStatCard,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { Eye, EyeOff, FileBarChart, Send } from "lucide-react";

export const metadata = { title: "Reports · Estate admin" };
export const dynamic = "force-dynamic";

function titleCase(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getReports() {
  const [reports, total, clientVisible, sentToClient] = await Promise.all([
    db.report
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          jobId: true,
          createdAt: true,
          clientVisible: true,
          cleanerVisible: true,
          sentToClient: true,
          job: {
            select: {
              jobNumber: true,
              jobType: true,
              scheduledDate: true,
              property: { select: { name: true, suburb: true, client: { select: { name: true } } } },
            },
          },
        },
      })
      .catch(() => []),
    db.report.count().catch(() => 0),
    db.report.count({ where: { clientVisible: true } }).catch(() => 0),
    db.report.count({ where: { sentToClient: true } }).catch(() => 0),
  ]);

  return { reports, total, clientVisible, sentToClient };
}

export default async function AdminReportsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const { reports, total, clientVisible, sentToClient } = await getReports();

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Commercial"
        title="Reports"
        description="Generated job reports and client visibility."
        actions={
          <Link href="/admin/reports">
            <EButton variant="gold" size="sm">Open reports console</EButton>
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard label="Total reports" value={String(total)} delta="generated" deltaTone="neutral" icon={<FileBarChart className="h-4 w-4" />} />
        <EStatCard label="Visible to client" value={String(clientVisible)} delta="published" deltaTone="neutral" icon={<Eye className="h-4 w-4" />} />
        <EStatCard label="Hidden from client" value={String(Math.max(0, total - clientVisible))} delta="internal only" deltaTone="neutral" icon={<EyeOff className="h-4 w-4" />} />
        <EStatCard label="Sent to client" value={String(sentToClient)} delta="delivered" deltaTone="neutral" icon={<Send className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <ECardTitle>Recent reports</ECardTitle>
          <Link href="/admin/reports"><EButton variant="ghost" size="sm">Filter & regenerate</EButton></Link>
        </ECardHeader>
        <ECardBody className="pt-0">
          {reports.length === 0 ? (
            <EEmptyState eyebrow="No reports yet" title="Nothing to show" description="Reports are generated after cleaner submissions." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Property", "Client", "Job", "Service date", "Visibility"].map((h) => (
                      <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-3 py-3 font-medium">{r.job?.property?.name ?? "—"}</td>
                      <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">{r.job?.property?.client?.name ?? "—"}</td>
                      <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))] whitespace-nowrap">{r.job?.jobNumber ? `#${r.job.jobNumber}` : "—"}{r.job?.jobType ? ` · ${titleCase(r.job.jobType)}` : ""}</td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap text-[hsl(var(--e-text-secondary))]">{r.job?.scheduledDate ? format(new Date(r.job.scheduledDate), "d MMM yy") : "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <EBadge tone={r.clientVisible ? "success" : "neutral"} soft>{r.clientVisible ? "Client" : "Hidden"}</EBadge>
                          {r.sentToClient ? <EBadge tone="gold" soft>Sent</EBadge> : null}
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

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · read-only · search, PDF export, regeneration, and visibility toggles open in the live console.</p>
    </div>
  );
}
