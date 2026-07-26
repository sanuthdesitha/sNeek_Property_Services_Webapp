/**
 * Live mid-clean progress for the client job page (gated by the
 * `showLiveProgress` client-visibility setting, OFF by default).
 *
 * Computation choice (documented):
 * 1. PRIMARY — the cleaner's shared draft envelope (one AppSetting query via
 *    getSharedCleanerJobDraft). Its `state.answers` / `state.uploads` hold the
 *    cleaner's live checklist input. We resolve the job's form template with
 *    the SAME rules as GET /api/jobs/[id]/form (property override →
 *    global-latest, excluding property-scoped templates) and count
 *    required fields (answerable + upload) that are visible for the current
 *    answers, using the shared lib/forms/visibility walkers. progress =
 *    answered-required / total-required.
 * 2. FALLBACK — when there is no draft or no template (or zero required
 *    fields), a stage/time heuristic: elapsed time since the clean started
 *    (arrivedAt, else "now within the scheduled window") over estimatedHours,
 *    clamped to 5–95 so the bar never claims done/not-started falsely.
 */
import { db } from "@/lib/db";
import type { AppSettings } from "@/lib/settings";
import { getSharedCleanerJobDraft } from "@/lib/cleaner/shared-job-draft";
import {
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
  isTemplateNodeVisible,
} from "@/lib/forms/visibility";
import { isUploadFieldType } from "@/lib/forms/field-types";

type ProgressJob = {
  id: string;
  jobType: any;
  propertyId: string;
  status: string;
  arrivedAt?: Date | string | null;
  estimatedHours?: number | null;
};

function isEmptyAnswer(value: unknown) {
  return (
    value == null ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Count visible required fields + how many are satisfied by the draft. */
export function countRequiredProgress(
  templateSchema: any,
  answers: Record<string, unknown>,
  uploadCounts: Record<string, number>,
  property: Record<string, unknown>
): { done: number; total: number } {
  const sections = Array.isArray(templateSchema?.sections) ? templateSchema.sections : [];
  let done = 0;
  let total = 0;
  for (const section of sections) {
    if (!isTemplateNodeVisible(section, answers, property)) continue;
    for (const field of flattenFieldsOneLevel(section?.fields)) {
      if (!field?.required || !field?.id) continue;
      if (!isFlattenedFieldVisible(field, answers, property)) continue;
      const id = String(field.id);
      total += 1;
      if (isUploadFieldType(field.type)) {
        if ((uploadCounts[id] ?? 0) > 0) done += 1;
      } else if (!isEmptyAnswer(answers[id])) {
        done += 1;
      }
    }
  }
  return { done, total };
}

/** Same template resolution as GET /api/jobs/[id]/form (simplified copy). */
async function resolveJobTemplate(job: ProgressJob, settings: AppSettings) {
  const overrides = (settings as any).propertyFormTemplateOverrides as
    | Record<string, Record<string, string>>
    | undefined;
  const configuredId = overrides?.[job.propertyId]?.[String(job.jobType)] ?? null;

  const propertyScopedTemplateIds = new Set<string>();
  for (const perProperty of Object.values(overrides ?? {})) {
    for (const templateId of Object.values(perProperty ?? {})) {
      if (typeof templateId === "string" && templateId) propertyScopedTemplateIds.add(templateId);
    }
  }

  let template = configuredId
    ? await db.formTemplate.findFirst({
        where: { id: configuredId, serviceType: job.jobType, isActive: true },
        select: { id: true, schema: true },
      })
    : null;
  if (!template) {
    template = await db.formTemplate.findFirst({
      where: {
        serviceType: job.jobType,
        isActive: true,
        ...(propertyScopedTemplateIds.size > 0
          ? { id: { notIn: Array.from(propertyScopedTemplateIds) } }
          : {}),
      },
      orderBy: { version: "desc" },
      select: { id: true, schema: true },
    });
  }
  return template;
}

/** Time-based fallback: elapsed / estimated, clamped to 5–95. */
function stageHeuristicPercent(job: ProgressJob): number {
  const startedAt = job.arrivedAt ? new Date(job.arrivedAt) : null;
  const estimatedMs = (Number(job.estimatedHours) || 0) * 60 * 60 * 1000;
  if (startedAt && !Number.isNaN(startedAt.getTime()) && estimatedMs > 0) {
    const elapsed = Date.now() - startedAt.getTime();
    const pct = Math.round((elapsed / estimatedMs) * 100);
    return Math.min(95, Math.max(5, pct));
  }
  // No timing signal at all — a neutral "underway" reading.
  return 50;
}

/**
 * progressPercent for an IN_PROGRESS job (null otherwise). Cheap: one
 * AppSetting read for the draft + at most two FormTemplate lookups.
 */
export async function computeJobProgressPercent(
  job: ProgressJob,
  settings: AppSettings,
  property: Record<string, unknown> = {}
): Promise<number | null> {
  if (job.status !== "IN_PROGRESS") return null;

  try {
    const draft = await getSharedCleanerJobDraft(job.id);
    if (draft?.state && typeof draft.state === "object") {
      const answers =
        draft.state.answers && typeof draft.state.answers === "object" && !Array.isArray(draft.state.answers)
          ? (draft.state.answers as Record<string, unknown>)
          : {};
      const uploadsRaw =
        draft.state.uploads && typeof draft.state.uploads === "object" && !Array.isArray(draft.state.uploads)
          ? (draft.state.uploads as Record<string, unknown>)
          : {};
      const uploadCounts: Record<string, number> = {};
      for (const [fieldId, media] of Object.entries(uploadsRaw)) {
        uploadCounts[fieldId] = Array.isArray(media) ? media.length : 0;
      }

      const template = await resolveJobTemplate(job, settings);
      if (template?.schema) {
        const { done, total } = countRequiredProgress(template.schema, answers, uploadCounts, property);
        if (total > 0) {
          return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
        }
      }
    }
  } catch {
    // Fall through to the heuristic — progress is decorative, never fatal.
  }

  return stageHeuristicPercent(job);
}
