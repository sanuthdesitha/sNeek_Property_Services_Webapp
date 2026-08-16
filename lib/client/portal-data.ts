import { JobStatus, JobType, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings, type ClientPortalVisibility } from "@/lib/settings";
import { resolvePortalScopeForUser } from "@/lib/auth/client-portal";
import { resolveJobFormTemplate } from "@/lib/forms/resolve-job-template";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  // Without EN_ROUTE the job disappeared from the client's board while the
  // cleaner was on the way, then reappeared at IN_PROGRESS.
  JobStatus.EN_ROUTE,
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

/**
 * Which checklist the client sees for each service type at a property. This is
 * a PROPERTY-level view, not a job-level one, so it deliberately carries no job
 * pin — a quote-minted one-off belongs to a single job and is not what this
 * property renders in general. Everything else (override usability, exclusion of
 * property/job-scoped rows from the global fallback, deterministic tie-break) is
 * delegated to the shared rule in lib/forms/resolve-job-template.ts so this view
 * can never drift from what the cleaner actually fills.
 */
async function resolvePropertyChecklistTemplates(propertyId: string) {
  const settings = await getAppSettings();
  const rawOverrides = settings.propertyFormTemplateOverrides?.[propertyId] ?? {};
  const activeTemplates = await db.formTemplate.findMany({
    where: { isActive: true },
    orderBy: [{ serviceType: "asc" }, { version: "desc" }],
  });

  const allJobTypes = new Set<JobType>([
    ...activeTemplates.map((template) => template.serviceType),
    ...(Object.keys(rawOverrides) as JobType[]),
  ]);

  return Array.from(allJobTypes)
    .map((jobType) => {
      const { template, source } = resolveJobFormTemplate({
        jobType,
        propertyId,
        overrides: settings.propertyFormTemplateOverrides,
        templates: activeTemplates,
      });
      if (!template) return null;
      return {
        jobType,
        source,
        id: template.id,
        name: template.name,
        version: template.version,
        sections: simplifyTemplateSchema(template.schema),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

/**
 * Which client this user reads, and which of that client's properties.
 *
 * Delegates to the portal chokepoint so a VA resolves through their team rather
 * than through `user.clientId` (which a VA does not have). The property scope
 * comes back WITH the client id on purpose: every query below filters on both,
 * so it is not possible to use one and forget the other and hand a VA their
 * client's whole portfolio.
 *
 * `propertyIds: null` means unrestricted — always true for a CLIENT.
 */
async function getPortalScope(userId: string) {
  return resolvePortalScopeForUser(userId);
}

/** The property-id filter for a scope, or {} when unrestricted. */
function scopedPropertyFilter(scope: { propertyIds: string[] | null }) {
  return scope.propertyIds ? { id: { in: scope.propertyIds } } : {};
}

/** The same restriction expressed against a nested `property` relation. */
function scopedNestedPropertyFilter(scope: { clientId: string; propertyIds: string[] | null }) {
  return scope.propertyIds
    ? { clientId: scope.clientId, id: { in: scope.propertyIds } }
    : { clientId: scope.clientId };
}

export async function listClientPropertiesForUser(userId: string) {
  const scope = await getPortalScope(userId);
  if (!scope) return [];
  const clientId = scope.clientId;

  return db.property.findMany({
    where: { clientId, isActive: true, ...scopedPropertyFilter(scope) },
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
  const scope = await getPortalScope(userId);
  if (!scope) return null;
  const clientId = scope.clientId;

  const property = await db.property.findFirst({
    // The id filter is ANDed with the scope, so a scoped VA asking for a
    // property outside their grant gets null — the same answer as a property
    // that does not exist.
    where: { id: propertyId, clientId, isActive: true, ...scopedPropertyFilter(scope) },
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

/**
 * How far back the client jobs board reaches, and how many rows it will carry.
 *
 * This used to be a bare `take: 100` ordered `scheduledDate DESC`. Descending
 * means furthest-FUTURE first, so a client with recurring bookings filled all
 * 100 slots with scheduled work and their past jobs never reached the browser
 * at all — the board's "Past services" section then had nothing to show and
 * disappeared, with no indication anything had been dropped. Filtering to a
 * past date then looked like the filters were broken.
 *
 * Bounding the window by DATE rather than by row count is what fixes it: every
 * job in the last year is included regardless of how much future work exists.
 * The cap is a safety limit, not the selection rule.
 */
const CLIENT_JOBS_HISTORY_DAYS = 365;
const CLIENT_JOBS_MAX = 500;

export async function listClientJobsForUser(userId: string) {
  const scope = await getPortalScope(userId);
  if (!scope) return [];

  const historyFrom = new Date();
  historyFrom.setDate(historyFrom.getDate() - CLIENT_JOBS_HISTORY_DAYS);

  return db.job
    .findMany({
      where: {
        property: scopedNestedPropertyFilter(scope),
        scheduledDate: { gte: historyFrom },
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        cleanSkipStatus: true,
        cleanSkipReason: true,
        cleanSkipAt: true,
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
      take: CLIENT_JOBS_MAX,
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
  const scope = await getPortalScope(userId);
  if (!scope) return [];

  // The mirror of the jobs bug: this was `pickupDate ASC` with `take: 200`,
  // i.e. the two hundred OLDEST tasks. A client with any history had their
  // CURRENT laundry cut off the end. Bounding by date keeps the recent window
  // whole; the cap is a safety limit, not the selection rule.
  const historyFrom = new Date();
  historyFrom.setDate(historyFrom.getDate() - CLIENT_JOBS_HISTORY_DAYS);

  return db.laundryTask.findMany({
    where: {
      property: scopedNestedPropertyFilter(scope),
      // pickupDate is non-nullable on LaundryTask, so a plain lower bound is
      // enough — no null branch to consider.
      pickupDate: { gte: historyFrom },
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
  const scope = await getPortalScope(userId);
  if (!scope) return [];

  // The caller-supplied propertyId and the actor's scope must BOTH hold, so the
  // scope goes in an AND rather than being spread over `id` — spreading would
  // let a scoped VA name any property of their client and have it win.
  const propertyWhere: Prisma.PropertyWhereInput = { clientId: scope.clientId };
  if (options?.propertyId) propertyWhere.id = options.propertyId;
  if (scope.propertyIds) propertyWhere.AND = [{ id: { in: scope.propertyIds } }];

  const where: Prisma.ReportWhereInput = {
    clientVisible: true,
    job: {
      property: propertyWhere,
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
