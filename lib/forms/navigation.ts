import { collectFormErrors } from "./validate-submission";
import { flattenFieldsOneLevel, isFlattenedFieldVisible, isTemplateNodeVisible } from "./visibility";
import { isUploadFieldType } from "./field-types";
import { stripHtmlToText } from "./sanitize";
export type FormRoomProgress = { id: string; label: string; visible: boolean; total: number; done: number; notApplicable: number; answeredNotApplicable: number;
  remaining: ReturnType<typeof collectFormErrors>; dataTotal: number; dataDone: number; mediaTotal: number; mediaDone: number };

/** Read-only projection: navigation never supplies answers, exemptions or receipts. */
export function formNavigation(schema: any, answers: Record<string, unknown>, uploads: Record<string, number>, property: Record<string, unknown>, laundryReady?: boolean, ticksRequired = false, canUseNoPhoto = false) {
  const errors = collectFormErrors(schema, answers, uploads, property, laundryReady, ticksRequired, { canUseNoPhoto, reasons: (answers.__noPhotoReasons ?? {}) as any });
  const rooms: FormRoomProgress[] = (Array.isArray(schema?.sections) ? schema.sections : []).map((section: any) => {
    const visible = isTemplateNodeVisible(section, answers, property, laundryReady);
    const fields = flattenFieldsOneLevel(section.fields);
    const required = fields.filter(field => field.required === true || (["photo", "file"].includes(field.type) && Number(field.minPhotos) > 0));
    const applicable = required.filter(field => visible && isFlattenedFieldVisible(field, answers, property, laundryReady));
    const remaining = errors.filter(error => error.sectionId === section.id);
    const incomplete = new Set(remaining.map(error => error.fieldId));
    const completed = applicable.filter(field => !incomplete.has(String(field.id)) && !incomplete.has(`${field.id}_details`));
    const notApplicable = required.length - applicable.length;
    return { id: String(section.id), label: stripHtmlToText(section.title ?? section.label ?? section.id), visible,
      total: applicable.length, done: completed.length, notApplicable, remaining,
      answeredNotApplicable: applicable.filter(field => field.type === "yesno" && field.includeNa === true && answers[String(field.id)] === "na").length,
      dataTotal: applicable.filter(field => !isUploadFieldType(field.type)).length,
      dataDone: completed.filter(field => !isUploadFieldType(field.type)).length,
      mediaTotal: applicable.filter(field => isUploadFieldType(field.type)).length,
      mediaDone: completed.filter(field => isUploadFieldType(field.type)).length };
  });
  return { rooms, errors };
}
