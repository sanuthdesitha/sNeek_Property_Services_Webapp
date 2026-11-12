import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { SUBMISSION_SORTS, listFormSubmissions, parseSubmissionFilters } from "@/lib/forms/submission-list";

/**
 * GET — form submissions.
 * - `paginated=1` (the Forms page's Submissions view): server paging, sorting
 *   (submitted, form, property, job, cleaner) and filters, summaries only.
 * - otherwise the old shape (latest 200 with media), kept for older callers.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    if (searchParams.get("paginated") === "1") {
      const query = parseListQuery(searchParams, { sortable: SUBMISSION_SORTS, defaultSort: "submitted", defaultDir: "desc", defaultPageSize: 25, maxPageSize: 100 });
      const timeZone = (await getAppSettings()).timezone || "Australia/Sydney";
      return NextResponse.json(await listFormSubmissions(parseSubmissionFilters(searchParams), query, timeZone), { headers: { "Cache-Control": "private, no-store" } });
    }
    const templateId = searchParams.get("templateId") || undefined;

    const submissions = await db.formSubmission.findMany({
      where: { ...(templateId ? { templateId } : {}) },
      include: {
        template: { select: { id: true, name: true, serviceType: true, schema: true } },
        submittedBy: { select: { id: true, name: true, email: true } },
        media: { select: { id: true, fieldId: true, url: true, mediaType: true, createdAt: true, s3Key: true, mimeType: true, label: true } },
        job: {
          select: {
            id: true,
            status: true,
            scheduledDate: true,
            jobType: true,
            report: { select: { id: true, pdfUrl: true, updatedAt: true } },
            property: { select: { id: true, name: true, suburb: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json(submissions);
  } catch (err: any) {
    if (isListQueryError(err)) return NextResponse.json({ error: err.message }, { status: 400 });
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
