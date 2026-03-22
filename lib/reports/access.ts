import { db } from "@/lib/db";
import { REPORT_TEMPLATE_VERSION, generateJobReport } from "@/lib/reports/generator";

type ReportWithJob = NonNullable<
  Awaited<
  ReturnType<
    typeof db.report.findUnique<{
      where: { jobId: string };
      include: {
        job: {
          include: {
            property: true;
          };
        };
      };
    }>
  >
  >
>;

export async function findJobReport(jobId: string) {
  return db.report.findUnique({
    where: { jobId },
    include: {
      job: {
        include: {
          property: true,
        },
      },
    },
  });
}

export async function getStoredJobReport(jobId: string) {
  return findJobReport(jobId);
}

export function hasCurrentReportTemplate(report: { htmlContent: string | null } | null | undefined) {
  return Boolean(report?.htmlContent?.includes(`report-template:${REPORT_TEMPLATE_VERSION}`));
}

export async function ensureStoredJobReport(jobId: string): Promise<ReportWithJob> {
  let report = await findJobReport(jobId);
  if (report) {
    return report;
  }

  await generateJobReport(jobId);
  report = await findJobReport(jobId);
  if (!report) {
    throw new Error("Report not yet available");
  }
  return report;
}
