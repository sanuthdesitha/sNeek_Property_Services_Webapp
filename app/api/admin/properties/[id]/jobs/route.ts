import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * All jobs for a property with the per-job artifacts admins jump to from the
 * property page: the job itself, its form submission, the generated report
 * (downloadable), laundry outcome, damage cases, and maintenance items. Plus a
 * compact performance roll-up so the Jobs tab is both a history and a scorecard.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const jobs = await db.job.findMany({
      where: { propertyId: params.id },
      orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        completedAt: true,
        cleanSkipStatus: true,
        assignments: {
          where: { removedAt: null },
          select: { user: { select: { name: true, email: true } } },
        },
        qaReviews: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { score: true, passed: true },
        },
        formSubmissions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, laundryOutcome: true, createdAt: true },
        },
        report: { select: { id: true, clientVisible: true } },
        laundryTask: { select: { id: true, status: true } },
        _count: { select: { issueTickets: true, maintenanceItems: true } },
      },
    });

    const shaped = jobs.map((job) => {
      const cleaners = Array.from(
        new Set(
          job.assignments
            .map((a) => a.user?.name?.trim() || a.user?.email?.trim() || "")
            .filter(Boolean),
        ),
      );
      const qa = job.qaReviews[0]
        ? { score: Math.round(Number(job.qaReviews[0].score ?? 0)), passed: Boolean(job.qaReviews[0].passed) }
        : null;
      const submission = job.formSubmissions[0] ?? null;
      return {
        id: job.id,
        jobNumber: job.jobNumber,
        jobType: job.jobType,
        status: job.status,
        scheduledDate: job.scheduledDate,
        startTime: job.startTime,
        dueTime: job.dueTime,
        completedAt: job.completedAt,
        skipped: String(job.cleanSkipStatus ?? "") === "SKIPPED",
        cleaners,
        qa,
        hasForm: Boolean(submission),
        submissionAt: submission?.createdAt ?? null,
        laundryOutcome: submission?.laundryOutcome ?? null,
        hasReport: Boolean(job.report),
        reportClientVisible: job.report?.clientVisible ?? false,
        hasLaundry: Boolean(job.laundryTask),
        issueCount: job._count.issueTickets,
        maintenanceCount: job._count.maintenanceItems,
      };
    });

    // ---- Performance roll-up ----
    const completedStatuses = new Set(["COMPLETED", "INVOICED"]);
    const completed = shaped.filter((j) => completedStatuses.has(j.status));
    const qaScores = shaped.map((j) => j.qa?.score).filter((s): s is number => typeof s === "number");
    const avgQa = qaScores.length > 0 ? Math.round(qaScores.reduce((a, b) => a + b, 0) / qaScores.length) : null;
    const qaPassRate =
      shaped.filter((j) => j.qa).length > 0
        ? Math.round(
            (shaped.filter((j) => j.qa?.passed).length / shaped.filter((j) => j.qa).length) * 100,
          )
        : null;
    const lastCompleted = completed
      .map((j) => j.completedAt)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    const stats = {
      total: shaped.length,
      completed: completed.length,
      upcoming: shaped.filter((j) => !completedStatuses.has(j.status) && !j.skipped).length,
      skipped: shaped.filter((j) => j.skipped).length,
      avgQa,
      qaPassRate,
      openIssues: shaped.reduce((sum, j) => sum + j.issueCount, 0),
      maintenanceItems: shaped.reduce((sum, j) => sum + j.maintenanceCount, 0),
      reports: shaped.filter((j) => j.hasReport).length,
      lastCompleted,
    };

    return NextResponse.json({ jobs: shaped, stats });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to load property jobs" }, { status: 500 });
  }
}
