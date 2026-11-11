/**
 * The QA issue row the admin screens read: the shape GET /api/admin/qa/issues
 * has always returned, now shared by that route and the Quality hub's paged
 * list. The linked pay adjustment has no Prisma relation (payAdjustmentId is a
 * bare column), so it is resolved in one extra query and stitched on.
 */
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const ISSUE_ROW_INCLUDE = {
  job: {
    select: {
      id: true,
      jobNumber: true,
      scheduledDate: true,
      property: { select: { id: true, name: true, suburb: true } },
    },
  },
  property: { select: { id: true, name: true, suburb: true } },
  cleaner: { select: { id: true, name: true, email: true } },
  raisedBy: { select: { id: true, name: true, email: true } },
  rectifiedBy: { select: { id: true, name: true } },
  qaReview: { select: { id: true, score: true, rating: true, managementReview: true } },
} satisfies Prisma.QaIssueInclude;

type IssueWithRelations = Prisma.QaIssueGetPayload<{ include: typeof ISSUE_ROW_INCLUDE }>;

export type IssuePayAdjustment = {
  id: string;
  status: string | null;
  requestedAmount: number | null;
  approvedAmount: number | null;
  source: string | null;
};

export type QualityIssueRow = {
  id: string;
  category: string;
  severity: string;
  description: string;
  rectificationStatus: string;
  rectificationMinutes: number | null;
  rectificationCost: number | null;
  rectificationBeforeKeys: unknown;
  rectificationAfterKeys: unknown;
  falseConfirmation: string;
  guestReadyImpact: boolean;
  cleanerMarkedComplete: boolean;
  qaPhotoKeys: unknown;
  escalatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  jobId: string;
  propertyId: string;
  cleanerId: string;
  job: {
    id: string;
    jobNumber: string | null;
    scheduledDate: Date | string | null;
    propertyName: string | null;
    propertySuburb: string | null;
  } | null;
  property: { id: string; name: string; suburb: string | null } | null;
  cleaner: { id: string; name: string } | null;
  raisedBy: { id: string; name: string } | null;
  rectifiedBy: { id: string; name: string | null } | null;
  review: { id: string; score: number | null; rating: string | null; managementReview: boolean } | null;
  payAdjustment: IssuePayAdjustment | null;
};

function personName(person: { name: string | null; email: string } | null): string {
  return person?.name ?? person?.email ?? "";
}

export async function toIssueRows(issues: IssueWithRelations[]): Promise<QualityIssueRow[]> {
  const payAdjustmentIds = Array.from(
    new Set(issues.map((issue) => issue.payAdjustmentId).filter((id): id is string => Boolean(id))),
  );
  const payAdjustments = payAdjustmentIds.length
    ? await db.cleanerPayAdjustment.findMany({
        where: { id: { in: payAdjustmentIds } },
        select: { id: true, status: true, requestedAmount: true, approvedAmount: true, source: true },
      })
    : [];
  const payMap = new Map(payAdjustments.map((pa) => [pa.id, pa]));

  return issues.map((issue) => {
    const pa = issue.payAdjustmentId ? payMap.get(issue.payAdjustmentId) : undefined;
    return {
      id: issue.id,
      category: issue.category,
      severity: issue.severity,
      description: issue.description,
      rectificationStatus: issue.rectificationStatus,
      rectificationMinutes: issue.rectificationMinutes,
      rectificationCost: issue.rectificationCost,
      rectificationBeforeKeys: issue.rectificationBeforeKeys ?? null,
      rectificationAfterKeys: issue.rectificationAfterKeys ?? null,
      falseConfirmation: issue.falseConfirmation,
      guestReadyImpact: issue.guestReadyImpact,
      cleanerMarkedComplete: issue.cleanerMarkedComplete,
      qaPhotoKeys: issue.qaPhotoKeys ?? null,
      escalatedAt: issue.escalatedAt,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      jobId: issue.jobId,
      propertyId: issue.propertyId,
      cleanerId: issue.cleanerId,
      job: issue.job
        ? {
            id: issue.job.id,
            jobNumber: issue.job.jobNumber,
            scheduledDate: issue.job.scheduledDate,
            propertyName: issue.job.property?.name ?? issue.property?.name ?? null,
            propertySuburb: issue.job.property?.suburb ?? issue.property?.suburb ?? null,
          }
        : null,
      property: issue.property ? { id: issue.property.id, name: issue.property.name, suburb: issue.property.suburb } : null,
      cleaner: issue.cleaner ? { id: issue.cleaner.id, name: personName(issue.cleaner) } : null,
      raisedBy: issue.raisedBy ? { id: issue.raisedBy.id, name: personName(issue.raisedBy) } : null,
      rectifiedBy: issue.rectifiedBy ? { id: issue.rectifiedBy.id, name: issue.rectifiedBy.name } : null,
      review: issue.qaReview
        ? {
            id: issue.qaReview.id,
            score: issue.qaReview.score,
            rating: issue.qaReview.rating,
            managementReview: issue.qaReview.managementReview,
          }
        : null,
      payAdjustment: issue.payAdjustmentId
        ? pa
          ? { id: pa.id, status: pa.status, requestedAmount: pa.requestedAmount, approvedAmount: pa.approvedAmount, source: pa.source }
          : { id: issue.payAdjustmentId, status: null, requestedAmount: null, approvedAmount: null, source: null }
        : null,
    };
  });
}
