import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { JobType, Role } from "@prisma/client";
import { validateSurveyForApproval } from "@/lib/onboarding/approval/workflow";
import { readFormMeta } from "@/lib/onboarding/form-meta";

/**
 * Approval preview: returns the validation problems (blocking errors) plus a
 * summary of exactly what entities will be created if the survey is approved.
 * Used by the admin review screen so the reviewer sees the outcome before
 * committing, and so the Approve button can be disabled when data is missing.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const survey = await db.propertyOnboardingSurvey.findUnique({
      where: { id: params.id },
      include: {
        appliances: true,
        specialRequests: true,
        laundryDetail: true,
        accessDetails: { orderBy: { sortOrder: "asc" } },
        jobTypeAnswers: true,
        existingClient: true,
        laundrySupplier: { select: { id: true, name: true } },
      },
    });
    if (!survey) return NextResponse.json({ error: "Survey not found." }, { status: 404 });

    const errors = validateSurveyForApproval(survey);
    const meta = readFormMeta(survey.adminOverrides);

    const metaJobTypes = Array.isArray(meta.selectedJobTypes) ? meta.selectedJobTypes : [];
    const answerJobTypes = survey.jobTypeAnswers.map((a) => a.jobType as string);
    const candidateTypes = metaJobTypes.length ? metaJobTypes : answerJobTypes;
    const jobTypes = candidateTypes.filter((jt) => Object.values(JobType).includes(jt as JobType));

    const hasGeo =
      typeof meta.propertyLatitude === "number" && typeof meta.propertyLongitude === "number";

    const preview = {
      client: survey.isNewClient
        ? { action: "create", name: (survey.clientData as any)?.name ?? "(unnamed)" }
        : { action: "link", name: survey.existingClient?.name ?? survey.existingClientId ?? "(unknown)" },
      property: {
        name: survey.propertyName ?? survey.propertyAddress ?? "New Property",
        address: survey.propertyAddress,
        suburb: survey.propertySuburb,
        willGeocode: !hasGeo && !!survey.propertyAddress,
        hasCoordinates: hasGeo,
        laundryEnabled: survey.laundryDetail?.hasLaundry ?? false,
      },
      integration: survey.icalUrl ? { provider: survey.icalProvider ?? "ICAL_OTHER", url: survey.icalUrl } : null,
      laundryTask:
        survey.laundryDetail?.hasLaundry && jobTypes.length > 0
          ? { supplier: survey.laundrySupplier?.name ?? null }
          : null,
      jobs: jobTypes.map((jt) => jt.replace(/_/g, " ")),
      jobCount: jobTypes.length,
    };

    return NextResponse.json({
      canApprove: errors.length === 0,
      errors,
      preview,
      formMeta: meta,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
