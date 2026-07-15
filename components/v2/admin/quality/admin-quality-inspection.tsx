"use client";

/**
 * ESTATE v2 — Admin Quality inspection surface.
 *
 * The admin Quality queue (/v2/admin/quality) deep-links each inspection to
 * /v2/admin/quality/[assignmentId]. Rather than fork the ~1600-line QA
 * inspection flow, this reuses the canonical `QaInspectionWorkspace` — the same
 * component the QA-inspector app uses — talking to the same GET/POST
 * /api/qa/jobs/[id] endpoints (scoring via lib/qa, QAReview persistence,
 * QaAssignment → COMPLETED transition, and rework-job creation on fail).
 *
 * The only admin-specific tweak is where "Back to queue" and the post-submit
 * redirect land: the admin Quality queue instead of the inspector queue.
 */
import { QaInspectionWorkspace } from "@/components/v2/qa/qa-inspection-workspace";

export function AdminQualityInspection({ jobId }: { jobId: string }) {
  return <QaInspectionWorkspace jobId={jobId} returnHref="/v2/admin/quality" />;
}
