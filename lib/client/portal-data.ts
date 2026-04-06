import { JobStatus, JobType, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings, type ClientPortalVisibility } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

function parseConfirmationMeta(notes: string | null | undefined) {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

function simplifyTemplateSchema(schema: unknown) {
  if (!schema || typeof schema !== "object") return [];
  const rawSections = (schema as { sections?: unknown[] }).sections;
  if (!Array.isArray(rawSections)) return [];

  return rawSections.map((rawSection, index) => {
    const section = rawSection as Record<string, unknown>;
    const rawFields = Array.isArray(section.fields) ? section.fields : [];
    const fields = rawFields.map((rawField, fieldIndex) => {
      const field = rawField as Record<string, unknown>;
      return {
        id: String(field.id ?? `field-${fieldIndex}`),
        label: String(field.label ?? field.title ?? `Field ${fieldIndex + 1}`),
        type: String(field.type ?? "text"),
        required: field.required === true,
      };
    });

    return {
      id: String(section.id ?? `section-${index}`),
      label: String(section.label ?? section.title ?? `Section ${index + 1}`),
      fields,
    };
  });
}

async function resolvePropertyChecklistTemplates(propertyId: string) {
  const settings = await getAppSettings();
  const rawOverrides = settings.propertyFormTemplateOverrides?.[propertyId] ?? {};
  const overrideIds = Object.values(rawOverrides).filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  const overrideTemplates = overrideIds.length
    ? await db.formTemplate.findMany({
        where: { id: { in: overrideIds }, isActive: true },
      })
    : [];
  const activeTemplates = await db.formTemplate.findMany({
    where: { isActive: true },
    orderBy: [{ serviceType: "asc" }, { version: "desc" }],
  });

  const latestByJobType = new Map<JobType, (typeof activeTemplates)[number]>();
  for (const template of activeTemplates) {
    if (!latestByJobType.has(template.serviceType)) {
      latestByJobType.set(template.serviceType, template);
    }
  }

  const overrideById = new Map(overrideTemplates.map((template) => [template.id, template]));
  const allJobTypes = new Set<JobType>([
    ...Array.from(latestByJobType.keys()),
    ...(Object.keys(rawOverrides) as JobType[]),
  ]);

  return Array.from(allJobTypes)
    .map((jobType) => {
      const overrideId = rawOverrides[jobType];
      const template =
        (overrideId && overrideById.get(overrideId)) || latestByJobType.get(jobType) || null;
      if (!template) return null;
      return {
        jobType,
        source: overrideId && overrideById.get(overrideId) ? "property_override" : "global_latest",
        id: template.id,
        name: template.name,
        version: template.version,
        sections: simplifyTemplateSchema(template.schema),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

async function getClientIdForUser(userId: string) {
  const portal = await getClientPortalContext(userId);
  return portal.clientId;
}

export async function listClientPropertiesForUser(userId: string) {
  const clientId = await getClientIdForUser(userId);
  if (!clientId) return [];

  return db.property.findMany({
    where: { clientId, isActive: true },
    select: {
      id: true,
      name: true,
      address: true,
      suburb: true,
      state: true,
      postcode: true,
      bedrooms: true,
      bathrooms: true,
      hasBalcony: true,
      inventoryEnabled: true,
      accessInfo: true,
      _count: {
        select: {
          jobs: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function getClientPropertyDetailForUser(
  userId: string,
  propertyId: string,
  visibility: ClientPortalVisibility
) {
  const clientId = await getClientIdForUser(userId);
  if (!clientId) return null;

  const property = await db.property.findFirst({
    where: { id: propertyId, clientId, isActive: true },
    select: {
      id: true,
      name: true,
      address: true,
      suburb: true,
      state: true,
      postcode: true,
      bedrooms: true,
      bathrooms: true,
      hasBalcony: true,
      inventoryEnabled: true,
      notes: true,
      accessInfo: true,
      preferredCleanerUserId: true,
    },
  });
  if (!property) return null;

  const [reports, jobs, laundryTasks, stocks, checklistTemplates, jobTasks, conditionTimeline, preferredCleanerOptions] = await Promise.all([
    visibility.showReports
      ? db.report.findMany({
          where: {
            clientVisible: true,
            job: { propertyId, status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] } },
          },
          select: {
            id: true,
            createdAt: true,
            generatedAt: true,
            sentToClient: true,
            pdfUrl: true,
            job: {
              select: {
                id: true,
                jobNumber: true,
                jobType: true,
                scheduledDate: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
    db.job.findMany({
      where: {
        propertyId,
        status: { in: ACTIVE_JOB_STATUSES },
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        priorityBucket: true,
        priorityReason: true,
        assignments: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { dueTime: "asc" }],
      take: 12,
    }),
    visibility.showLaundryUpdates
      ? db.laundryTask.findMany({
          where: { propertyId },
          select: {
            id: true,
            status: true,
            pickupDate: true,
            dropoffDate: true,
            updatedAt: true,
            noPickupRequired: true,
            skipReasonCode: true,
            skipReasonNote: true,
            adminOverrideNote: true,
            confirmations: {
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                createdAt: true,
                laundryReady: true,
                bagLocation: true,
                photoUrl: true,
                notes: true,
              },
            },
            job: {
              select: {
                id: true,
                jobNumber: true,
                scheduledDate: true,
                jobType: true,
              },
            },
          },
          orderBy: [{ pickupDate: "asc" }],
          take: 20,
        })
      : Promise.resolve([]),
    visibility.showInventory
      ? db.propertyStock.findMany({
          where: { propertyId },
          select: {
            id: true,
            onHand: true,
            parLevel: true,
            reorderThreshold: true,
            item: {
              select: {
                id: true,
                name: true,
                category: true,
                unit: true,
                location: true,
              },
            },
          },
          orderBy: [{ item: { location: "asc" } }, { item: { name: "asc" } }],
          take: 200,
        })
      : Promise.resolve([]),
    visibility.showChecklistPreview ? resolvePropertyChecklistTemplates(propertyId) : Promise.resolve([]),
    visibility.showClientTaskRequests
      ? db.jobTask.findMany({
          where: { propertyId, clientId, source: { in: ["CLIENT", "CARRY_FORWARD"] } },
          select: {
            id: true,
            title: true,
            approvalStatus: true,
            executionStatus: true,
            createdAt: true,
            updatedAt: true,
            jobId: true,
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
    visibility.showReports
      ? db.submissionMedia.findMany({
          where: {
            submission: {
              job: {
                propertyId,
                status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] },
              },
            },
          },
          select: {
            id: true,
            mediaType: true,
            url: true,
            createdAt: true,
            label: true,
            submission: {
              select: {
                createdAt: true,
                job: {
                  select: {
                    id: true,
                    jobNumber: true,
                    jobType: true,
                    scheduledDate: true,
                  },
                },
              },
            },
          },
          orderBy: [{ submission: { job: { scheduledDate: "desc" } } }, { createdAt: "desc" }],
          take: 120,
        })
      : Promise.resolve([]),
    db.user.findMany({
      where: {
        role: "CLEANER",
        isActive: true,
        jobAssignments: {
          some: {
            job: {
              propertyId,
            },
            removedAt: null,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { name: "asc" },
      take: 50,
    }),
  ]);

  const activity = [
    ...reports.map((report) => ({
      type: "report",
      at: report.createdAt,
      label: `Report ready for ${report.job.jobType.replace(/_/g, " ")}`,
      detail: report.job.jobNumber ? `Job ${report.job.jobNumber}` : property.name,
    })),
    ...jobs.map((job) => ({
      type: "job",
      at: job.scheduledDate,
      label: `${job.jobType.replace(/_/g, " ")} job ${job.jobNumber ?? ""}`.trim(),
      detail: job.status.replace(/_/g, " "),
    })),
    ...laundryTasks.map((task) => ({
      type: "laundry",
      at: task.updatedAt,
      label: `Laundry ${task.status.replace(/_/g, " ").toLowerCase()}`,
      detail: task.job.jobNumber ? `Job ${task.job.jobNumber}` : property.name,
    })),
    ...jobTasks
      .filter((task) => task.approvalStatus === "APPROVED" || task.approvalStatus === "AUTO_APPROVED")
      .map((task) => ({
        type: "task",
        at: task.updatedAt,
        label: `Task update: ${task.title}`,
        detail: task.executionStatus.replace(/_/g, " "),
      })),
  ].sort((left, right) => right.at.getTime() - left.at.getTime());

  return {
    property,
    reports,
    jobs,
    laundryTasks: laundryTasks.map((task) => ({
      ...task,
      confirmations: task.confirmations.map((confirmation) => ({
        ...confirmation,
        meta: parseConfirmationMeta(confirmation.notes),
      })),
    })),
    stocks,
    checklistTemplates,
    jobTasks,
    conditionTimeline,
    preferredCleanerOptions,
    activity,
  };
}

export async function listClientJobsForUser(userId: string) {
  const clientId = await getClientIdForUser(userId);
  if (!clientId) return [];

  return db.job
    .findMany({
      where: {
        property: { clientId },
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
          },
        },
        assignments: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        jobTasks: {
          select: {
            id: true,
            source: true,
            approvalStatus: true,
            executionStatus: true,
          },
        },
        laundryTask: {
          select: {
            id: true,
            status: true,
            pickupDate: true,
            dropoffDate: true,
            updatedAt: true,
            noPickupRequired: true,
            skipReasonCode: true,
            skipReasonNote: true,
            adminOverrideNote: true,
            pickedUpAt: true,
            droppedAt: true,
            confirmations: {
              orderBy: { createdAt: "desc" },
              take: 3,
              select: {
                id: true,
                createdAt: true,
                laundryReady: true,
                bagLocation: true,
                photoUrl: true,
                notes: true,
              },
            },
          },
        },
        satisfactionRating: {
          select: {
            score: true,
            comment: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ scheduledDate: "desc" }, { startTime: "desc" }, { dueTime: "desc" }],
      take: 100,
    })
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        laundryTask: row.laundryTask
          ? {
              ...row.laundryTask,
              confirmations: row.laundryTask.confirmations.map((confirmation) => ({
                ...confirmation,
                meta: parseConfirmationMeta(confirmation.notes),
              })),
            }
          : null,
      }))
    );
}

export async function listClientLaundryForUser(userId: string) {
  const clientId = await getClientIdForUser(userId);
  if (!clientId) return [];

  return db.laundryTask.findMany({
    where: {
      property: { clientId },
    },
    select: {
      id: true,
      status: true,
      pickupDate: true,
      dropoffDate: true,
      updatedAt: true,
      noPickupRequired: true,
      skipReasonCode: true,
      skipReasonNote: true,
      adminOverrideNote: true,
      property: {
        select: {
          id: true,
          name: true,
          suburb: true,
        },
      },
      job: {
        select: {
          id: true,
          jobNumber: true,
          scheduledDate: true,
          jobType: true,
        },
      },
      confirmations: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          laundryReady: true,
          bagLocation: true,
          photoUrl: true,
          notes: true,
        },
      },
    },
    orderBy: [{ pickupDate: "asc" }, { updatedAt: "desc" }],
    take: 200,
  }).then((rows) =>
    rows.map((row) => ({
      ...row,
      confirmations: row.confirmations.map((confirmation) => ({
        ...confirmation,
        meta: parseConfirmationMeta(confirmation.notes),
      })),
    }))
  );
}

export async function listClientReportsForUser(
  userId: string,
  options?: { propertyId?: string | null; fromDate?: Date | null }
) {
  const clientId = await getClientIdForUser(userId);
  if (!clientId) return [];

  const where: Prisma.ReportWhereInput = {
    clientVisible: true,
    job: {
      property: {
        clientId,
        ...(options?.propertyId ? { id: options.propertyId } : {}),
      },
      status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] },
    },
  };
  if (options?.fromDate) {
    where.createdAt = { gte: options.fromDate };
  }

  return db.report.findMany({
    where,
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          scheduledDate: true,
          property: { select: { id: true, name: true, suburb: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });
}
