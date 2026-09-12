import "server-only";
import { formRevision } from "./form-revision";
import type { ResolvedFinalCheckupItem } from "./final-checkup";
import { isLaundryUpdateEligible } from "@/lib/laundry/eligibility";
import { jobFormProperty } from "./job-form-property";

/** Project the actual visibility inputs, never Prisma records (Dates/Decimals). */
export function jobFormRevision(input: {
  template: { id: string; schema: unknown };
  job: { jobType: string; isRework?: boolean | null; property: Record<string, unknown> };
  settings: { accountability?: { requiredChecklistTicksBlockSubmit?: boolean; selfInspectionBlocksSubmit?: boolean } };
  canUseNoPhoto: boolean;
  finalCheckupItems: ResolvedFinalCheckupItem[];
}): string {
  const keys = new Set(["hasBalcony"]);
  function visit(node: any) {
    if (!node || typeof node !== "object") return;
    if (typeof node.conditional?.propertyField === "string") keys.add(node.conditional.propertyField);
    for (const key of ["sections", "fields", "children"]) {
      if (Array.isArray(node[key])) node[key].forEach(visit);
    }
  }
  visit(input.template.schema);
  const visibleProperty = jobFormProperty(input.template.schema, input.job.property);
  const property: Record<string, unknown> = Object.create(null);
  for (const key of Array.from(keys)) {
    if (Object.hasOwn(visibleProperty, key)) {
      property[key] = visibleProperty[key];
    }
  }
  return formRevision({ templateId: input.template.id, schema: input.template.schema,
    validationContext: {
      jobType: input.job.jobType, isRework: input.job.isRework === true,
      laundryEligible: isLaundryUpdateEligible(input.job, input.job.property),
      canUseNoPhoto: input.canUseNoPhoto,
      requiredChecklistTicksBlockSubmit: input.settings.accountability?.requiredChecklistTicksBlockSubmit === true,
      selfInspectionBlocksSubmit: input.settings.accountability?.selfInspectionBlocksSubmit !== false,
      property,
      finalCheckupItems: input.finalCheckupItems.map(item => ({ id: item.id, title: item.title,
        detail: item.detail, source: item.source, referenceImageKeys: [...item.referenceImageKeys] })),
    },
  });
}
