import Link from "next/link";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getPerformanceMetrics } from "@/lib/workforce/performance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Users, Star, Clock, CheckCircle2, ShieldCheck, FileCheck } from "lucide-react";

export const dynamic = "force-dynamic";

function scoreBand(
  percent: number | null,
): "success" | "warning" | "danger" | "neutral" {
  if (percent === null) return "neutral";
  if (percent >= 85) return "success";
  if (percent >= 70) return "warning";
  return "danger";
}

function ratingBand(
  rating: number | null,
): "success" | "warning" | "danger" | "neutral" {
  if (rating === null) return "neutral";
  if (rating >= 4.3) return "success";
  if (rating >= 3.5) return "warning";
  return "danger";
}

export default async function CleanerPerformancePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);

  const cleaners = await db.user.findMany({
    where: { role: Role.CLEANER, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      hourlyRate: true,
    },
    orderBy: { name: "asc" },
  });

  const metricsPerCleaner = await Promise.all(
    cleaners.map((c) =>
      getPerformanceMetrics(c.id, 30).then((metrics) => ({
        cleaner: c,
        metrics,
      })),
    ),
  );

  // Roster-wide rollup for the header strip
  const qualityScores = metricsPerCleaner
    .map((r) => r.metrics.quality.score)
    .filter((s): s is number => s !== null);
  const reliabilityScores = metricsPerCleaner
    .map((r) => r.metrics.reliability.onTimePercent)
    .filter((s): s is number => s !== null);
  const attendanceScores = metricsPerCleaner
    .map((r) => r.metrics.attendance.percent)
    .filter((s): s is number => s !== null);
  const satisfactionScores = metricsPerCleaner
    .map((r) => r.metrics.customerSatisfaction.avgRating)
    .filter((s): s is number => s !== null);
  const docComplianceScores = metricsPerCleaner
    .map((r) => r.metrics.documentCompliance.percent)
    .filter((s): s is number => s !== null);

  const avg = (xs: number[]) =>
    xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const avgFloat = (xs: number[]) =>
    xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  const rosterQuality = avg(qualityScores);
  const rosterReliability = avg(reliabilityScores);
  const rosterAttendance = avg(attendanceScores);
  const rosterSatisfaction = avgFloat(satisfactionScores);
  const rosterDocs = avg(docComplianceScores);

  // Sort cleaners by quality score descending (nulls last)
  const sorted = [...metricsPerCleaner].sort((a, b) => {
    const aq = a.metrics.quality.score;
    const bq = b.metrics.quality.score;
    if (aq === null && bq === null) return 0;
    if (aq === null) return 1;
    if (bq === null) return -1;
    return bq - aq;
  });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Cleaner Performance
        </h1>
        <p className="text-sm text-muted-foreground">
          30-day rolling metrics across {cleaners.length} active cleaner
          {cleaners.length === 1 ? "" : "s"}. Click a row for the full
          breakdown.
        </p>
      </header>

      {/* Roster rollup */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <RollupCard
          icon={Star}
          label="Roster quality"
          value={rosterQuality !== null ? `${rosterQuality}%` : "—"}
          sub={`${qualityScores.length} cleaners scored`}
        />
        <RollupCard
          icon={Clock}
          label="Roster reliability"
          value={rosterReliability !== null ? `${rosterReliability}%` : "—"}
          sub="On-time arrivals"
        />
        <RollupCard
          icon={CheckCircle2}
          label="Roster attendance"
          value={rosterAttendance !== null ? `${rosterAttendance}%` : "—"}
          sub="Completed vs assigned"
        />
        <RollupCard
          icon={Users}
          label="Customer rating"
          value={
            rosterSatisfaction !== null
              ? `★ ${rosterSatisfaction.toFixed(2)}`
              : "—"
          }
          sub="Avg of all ratings"
        />
        <RollupCard
          icon={ShieldCheck}
          label="Doc compliance"
          value={rosterDocs !== null ? `${rosterDocs}%` : "—"}
          sub="Current credentials"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck className="size-4" />
            Performance leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-medium">Cleaner</th>
                  <th className="p-3 text-left font-medium">Quality</th>
                  <th className="p-3 text-left font-medium">Reliability</th>
                  <th className="p-3 text-left font-medium">Attendance</th>
                  <th className="p-3 text-left font-medium">Customer</th>
                  <th className="p-3 text-left font-medium">Docs</th>
                  <th className="p-3 text-left font-medium">Training</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-6 text-center text-sm text-muted-foreground"
                    >
                      No active cleaners.
                    </td>
                  </tr>
                ) : (
                  sorted.map(({ cleaner, metrics }) => (
                    <tr
                      key={cleaner.id}
                      className="border-b border-border last:border-b-0 hover:bg-muted/20"
                    >
                      <td className="p-3">
                        <Link
                          href={`/admin/workforce/performance/${cleaner.id}`}
                          className="flex flex-col hover:underline"
                        >
                          <span className="font-medium">
                            {cleaner.name ?? cleaner.email}
                          </span>
                          {cleaner.name && (
                            <span className="text-xs text-muted-foreground">
                              {cleaner.email}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="p-3">
                        {metrics.quality.score !== null ? (
                          <StatusPill
                            variant={scoreBand(metrics.quality.score)}
                          >
                            {Math.round(metrics.quality.score)}% (n=
                            {metrics.quality.sampleSize})
                          </StatusPill>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {metrics.reliability.onTimePercent !== null ? (
                          <StatusPill
                            variant={scoreBand(
                              metrics.reliability.onTimePercent,
                            )}
                          >
                            {metrics.reliability.onTimePercent}% (n=
                            {metrics.reliability.sampleSize})
                          </StatusPill>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {metrics.attendance.percent !== null ? (
                          <StatusPill
                            variant={scoreBand(metrics.attendance.percent)}
                          >
                            {metrics.attendance.completedJobs}/
                            {metrics.attendance.assignedJobs}
                          </StatusPill>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {metrics.customerSatisfaction.avgRating !== null ? (
                          <StatusPill
                            variant={ratingBand(
                              metrics.customerSatisfaction.avgRating,
                            )}
                          >
                            ★{" "}
                            {metrics.customerSatisfaction.avgRating.toFixed(1)}{" "}
                            (n={metrics.customerSatisfaction.sampleSize})
                          </StatusPill>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {metrics.documentCompliance.percent !== null ? (
                          <StatusPill
                            variant={scoreBand(
                              metrics.documentCompliance.percent,
                            )}
                          >
                            {metrics.documentCompliance.percent}% (
                            {metrics.documentCompliance.current}/
                            {metrics.documentCompliance.current +
                              metrics.documentCompliance.expired}
                            )
                          </StatusPill>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {metrics.trainingCompletion.percent !== null ? (
                          <StatusPill
                            variant={scoreBand(
                              metrics.trainingCompletion.percent,
                            )}
                          >
                            {metrics.trainingCompletion.completed}/
                            {metrics.trainingCompletion.assigned}
                          </StatusPill>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Bands: 85%+ green · 70-84% amber · &lt;70% red. Ratings: 4.3+ green ·
        3.5-4.2 amber · &lt;3.5 red. "n=" shows sample size — small samples can
        swing percentages, treat with care.
      </p>
    </div>
  );
}

function RollupCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
