import { db } from "@/lib/db";
import { JobStatus, JobType } from "@prisma/client";
import { reserveJobNumber } from "@/lib/jobs/job-number";

interface ApproveInput {
  surveyId: string;
  adminReviewerId: string;
  adminNotes?: string | null;
  adminOverrides?: Record<string, unknown> | null;
  createJobsForTypes?: string[];
}

interface ApproveResult {
  ok: true;
  clientId?: string;
  propertyId?: string;
  integrationId?: string;
  jobIds: string[];
}

export async function approveSurvey(input: ApproveInput): Promise<ApproveResult> {
  const survey = await db.propertyOnboardingSurvey.findUnique({
    where: { id: input.surveyId },
    include: {
      appliances: true,
      specialRequests: true,
      laundryDetail: true,
      accessDetails: { orderBy: { sortOrder: "asc" } },
      jobTypeAnswers: true,
    },
  });

  if (!survey) throw new Error("Survey not found.");
  if (survey.status !== "PENDING_REVIEW") throw new Error("Survey must be pending review.");

  const overrides = (input.adminOverrides ?? {}) as Record<string, unknown>;
  const createJobTypes = input.createJobsForTypes ?? survey.jobTypeAnswers.map((a) => a.jobType);

  const result = await db.$transaction(async (tx) => {
    // 1. Create Client if new
    let clientId = survey.existingClientId;
    if (survey.isNewClient && survey.clientData) {
      const data = survey.clientData as Record<string, unknown>;
      const newClient = await tx.client.create({
        data: {
          name: String(data.name ?? ""),
          email: data.email ? String(data.email) : null,
          phone: data.phone ? String(data.phone) : null,
          address: data.address ? String(data.address) : null,
          notes: data.notes ? String(data.notes) : null,
        },
      });
      clientId = newClient.id;
    }

    if (!clientId) throw new Error("No client linked to survey.");

    // 2. Build accessInfo JSON from access details
    const accessInfo: Record<string, unknown> = {};
    const attachments: Record<string, unknown>[] = [];
    for (const detail of survey.accessDetails) {
      if (detail.detailType === "LOCKBOX") accessInfo.lockbox = detail.value;
      else if (detail.detailType === "KEY_LOCATION") accessInfo.keyLocation = detail.value;
      else if (detail.detailType === "PARKING") accessInfo.parking = detail.value;
      else if (detail.detailType === "BUILDING_ACCESS") accessInfo.instructions = detail.value;
      else if (detail.detailType === "ENTRY_PHOTO" && detail.photoKey) {
        attachments.push({ name: "onboarding_photo", url: detail.photoUrl, key: detail.photoKey });
      }
    }
    if (attachments.length > 0) accessInfo.attachments = attachments;

    // 3. Create Property
    const property = await tx.property.create({
      data: {
        clientId,
        name: survey.propertyName ?? survey.propertyAddress ?? "New Property",
        address: survey.propertyAddress ?? "",
        suburb: survey.propertySuburb ?? "",
        state: survey.propertyState,
        postcode: survey.propertyPostcode,
        notes: survey.propertyNotes,
        bedrooms: survey.bedrooms,
        bathrooms: survey.bathrooms,
        hasBalcony: survey.hasBalcony,
        accessInfo: accessInfo as any,
        defaultCheckinTime: "14:00",
        defaultCheckoutTime: "10:00",
        linenBufferSets: 0,
        inventoryEnabled: false,
        laundryEnabled: survey.laundryDetail?.hasLaundry ?? false,
      },
    });

    // 4. Create Integration if iCal URL provided
    let integrationId: string | undefined;
    if (survey.icalUrl) {
      const integration = await tx.integration.create({
        data: {
          propertyId: property.id,
          icalUrl: survey.icalUrl,
          provider: survey.icalProvider ?? "ICAL_OTHER",
          isEnabled: false,
          syncStatus: "IDLE",
        },
      });
      integrationId = integration.id;
    }

    // 4b. Create LaundryTask if laundry is enabled
    let laundryTaskId: string | undefined;
    if (survey.laundryDetail?.hasLaundry) {
      const pickupDate = new Date();
      pickupDate.setDate(pickupDate.getDate() + 1);
      const dropoffDate = new Date(pickupDate);
      dropoffDate.setDate(dropoffDate.getDate() + 2);

      const laundryTask = await tx.laundryTask.create({
        data: {
          propertyId: property.id,
          jobId: "",
          pickupDate,
          dropoffDate,
          status: "PENDING",
          supplierId: survey.laundrySupplierId || null,
        },
      });
      laundryTaskId = laundryTask.id;
    }

    // 5. Create Job drafts for selected job types
    const jobIds: string[] = [];
    const estimatedHours = (overrides.estimatedHours as number) ?? survey.estimatedHours;
    const cleanerCount = (overrides.cleanerCount as number) ?? survey.estimatedCleanerCount ?? survey.requestedCleanerCount;

    for (const jobType of createJobTypes) {
      if (!Object.values(JobType).includes(jobType as JobType)) continue;

      const specialRequestNotes = survey.specialRequests
        .map((r) => `[${r.priority}] ${r.area ? r.area + ": " : ""}${r.description}`)
        .join("\n");

      const applianceNotes = survey.appliances
        .filter((a) => a.requiresClean)
        .map((a) => `- ${a.applianceType}${a.conditionNote ? `: ${a.conditionNote}` : ""}`)
        .join("\n");

      const notes = [
        survey.adminNotes,
        specialRequestNotes,
        applianceNotes ? `Special appliances to clean:\n${applianceNotes}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      const jobNumber = await reserveJobNumber(tx);

      const job = await tx.job.create({
        data: {
          jobNumber,
          propertyId: property.id,
          jobType: jobType as JobType,
          status: JobStatus.UNASSIGNED,
          scheduledDate: new Date(),
          estimatedHours: estimatedHours ?? undefined,
          notes: notes || null,
          internalNotes: JSON.stringify({
            source: "onboarding",
            surveyId: survey.id,
            cleanerCount,
            onboardingNotes: survey.adminNotes,
          }),
        },
      });
      jobIds.push(job.id);

      if (laundryTaskId && jobIds.length === 1) {
        await tx.laundryTask.update({
          where: { id: laundryTaskId },
          data: { jobId: job.id },
        });
      }
    }

    // 6. Update survey
    await tx.propertyOnboardingSurvey.update({
      where: { id: survey.id },
      data: {
        status: "APPROVED",
        adminReviewerId: input.adminReviewerId,
        reviewedAt: new Date(),
        adminNotes: input.adminNotes,
        adminOverrides: input.adminOverrides ? (input.adminOverrides as any) : undefined,
        createdClientId: clientId,
        createdPropertyId: property.id,
        createdIntegrationId: integrationId,
        createdLaundryTaskId: laundryTaskId,
        createdJobIds: jobIds,
      },
    });

    return { clientId, propertyId: property.id, integrationId, laundryTaskId, jobIds };
  });

  return { ok: true, ...result };
}

export async function rejectSurvey(surveyId: string, adminReviewerId: string, reason: string) {
  await db.propertyOnboardingSurvey.update({
    where: { id: surveyId },
    data: {
      status: "REJECTED",
      adminReviewerId,
      reviewedAt: new Date(),
      rejectionReason: reason,
    },
  });
}
