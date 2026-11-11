/**
 * What every Jobs list row carries (list, export, board). Moved out of
 * `app/api/jobs/route.ts` unchanged so the board route reads the same shape.
 */
import { PayAdjustmentStatus } from "@prisma/client";

export const JOB_INCLUDE = {
  property: {
    select: {
      name: true,
      suburb: true,
      address: true,
      latitude: true,
      longitude: true,
      client: { select: { id: true, name: true, email: true } },
    },
  },
  assignments: {
    where: { removedAt: null },
    include: { user: { select: { id: true, name: true } } },
  },
  // The job's ACTIVE QA assignment, so a list can offer "assign inspector"
  // without a second round trip. Cancelled/completed inspections are excluded:
  // the question these surfaces ask is "who is inspecting this now?".
  qaAssignments: {
    where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] as any } },
    select: {
      id: true,
      status: true,
      assignedToId: true,
      assignedTo: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  qaReviews: {
    // `kind` distinguishes a real review (QA inspection / ADMIN quick score)
    // from a client rating, so the QA queue can tell "not yet reviewed" from
    // "reviewed and failed".
    select: { id: true, score: true, passed: true, createdAt: true, kind: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  report: { select: { id: true } },
  issueTickets: {
    where: { caseType: "DAMAGE", status: { not: "RESOLVED" } },
    select: { id: true, status: true, severity: true, title: true },
    take: 5,
  },
  // Pending extra-pay requests on this job — surfaced so the list can flag jobs
  // that need a pay decision.
  payAdjustments: {
    where: { status: PayAdjustmentStatus.PENDING },
    select: { id: true },
    take: 5,
  },
  _count: { select: { formSubmissions: true } },
};

