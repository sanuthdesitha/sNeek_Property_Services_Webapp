/** Explicit device exceptions retain the original field ID and historical boolean answers. */
export const DEVICE_EXCEPTION_LABELS = {
  NEEDS_ATTENTION: "Checked — needs attention",
  NOT_APPLICABLE: "Absent / not applicable",
  NOT_CHECKED: "Not checked / unknown",
} as const;
export type DeviceExceptionStatus = keyof typeof DEVICE_EXCEPTION_LABELS;
export type DeviceExceptionAnswer = { deviceStatus: DeviceExceptionStatus; reason: string };
export function isDeviceStatusField(field: { type?: unknown; label?: unknown; id?: unknown; deviceStatus?: unknown } | null | undefined): boolean {
  if (field?.deviceStatus === false) return false;
  if (!field || !["checkbox", "yesno", "select", "radio"].includes(String(field.type))) return false;
  // Ring/Minut are known device checks. Other device checks may explicitly opt in.
  // Do not infer applicability from generic cleaning, photo or safety-signoff fields.
  const label = String(field.label ?? "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return field.deviceStatus === true || /\bminut\b/i.test(label) || (/\bring\b/i.test(label) && (/camera|doorbell|batter|charg|working|device|check/i.test(label) || /^ring\??$/i.test(label.trim()))) || /^(?:ring|minut)[_-]?(?:charged|checked|working|battery)$/i.test(String(field.id ?? ""));
}
export function isDeviceException(value: unknown): value is DeviceExceptionAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.deviceStatus === "string" && Object.hasOwn(DEVICE_EXCEPTION_LABELS, raw.deviceStatus) && typeof raw.reason === "string";
}
export function isDeviceConfirmed(value: unknown) {
  return value === true || (typeof value === "string" && ["true", "yes"].includes(value.toLowerCase()));
}
export function isDeviceAnswerComplete(value: unknown) {
  return isDeviceConfirmed(value) || (isDeviceException(value) && value.reason.trim().length > 0 && value.reason.length <= 2000);
}
export function formatDeviceException(value: DeviceExceptionAnswer) {
  return `${DEVICE_EXCEPTION_LABELS[value.deviceStatus]}${value.reason.trim() ? ` — ${value.reason.trim()}` : " — reason not recorded"}`;
}
/** Owner-confirmed removal. Applied to active job assembly only, never stored history. */
export function withDeviceApplicability(schema: any, property?: { name?: unknown }) {
  if (!/^Jackson[\s_-]*(?:Property|P)[\s_-]*0*3$/i.test(String(property?.name ?? "").trim()) || !Array.isArray(schema?.sections)) return schema;
  const ringOnly = (field: any) => isDeviceStatusField(field) && /\bring\b/i.test(String(field.label ?? "") + " " + String(field.id ?? "").replace(/[_-]/g, " ")) && !/\bminut\b/i.test(String(field.label ?? "") + " " + String(field.id ?? ""));
  return { ...schema, sections: schema.sections.map((section: any) => ({ ...section,
    fields: [
      ...(section.fields ?? []).filter((field: any) => !ringOnly(field)).map((field: any) => Array.isArray(field.children) ? { ...field, children: field.children.filter((child: any) => !ringOnly(child)) } : field),
      ...((section.fields ?? []).some((field: any) => ringOnly(field) || field.children?.some(ringOnly)) ? [{ id: `${section.id}-ring-removed-p3-v1`, type: "instruction", label: "Ring camera removed from P3", helpText: "Ring camera removed from P3. Owner confirmed removal on 4 October 2026. No Ring charging or check is required at this property." }] : []),
    ],
  })), deviceApplicability: { ...(schema.deviceApplicability ?? {}), ring: { status: "REMOVED", propertyCode: "P3", source: "OWNER_INSTRUCTION", recordedDate: "2026-10-04" } } };
}

/** An explicit exception always needs a reason, including optional and QA fields. */
export function incompleteDeviceExceptions(schema: any, answers: Record<string, unknown>) {
  const invalid: Array<{ id: string; label: string }> = [];
  for (const section of Array.isArray(schema?.sections) ? schema.sections : []) {
    for (const parent of Array.isArray(section?.fields) ? section.fields : []) {
      for (const field of [parent, ...(Array.isArray(parent?.children) ? parent.children : [])]) {
        if (!field?.id) continue;
        const value = answers[field.id];
        if (isDeviceStatusField(field) && value && typeof value === "object" && !isDeviceAnswerComplete(value)) invalid.push({ id: field.id, label: field.label || field.id });
      }
    }
  }
  return invalid;
}
