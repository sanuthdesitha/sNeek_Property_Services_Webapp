import type { FormSchema, FormField } from "./types";
import { isDeviceStatusField } from "./device-status";

/** Extend current device checks; never rewrite stored templates or submitted reports. */
export function withDeviceChargingEvidence(
  schema: FormSchema,
  job: { jobType: string; isRework: boolean; property?: { name?: unknown } },
): FormSchema {
  const name = String(job.property?.name ?? "").trim();
  if (
    job.jobType !== "AIRBNB_TURNOVER" ||
    job.isRework ||
    !/^Jackson(?:[\s_-]|P\d|Property)/i.test(name)
  )
    return schema;
  const id = "jackson-device-charging-v1";
  if (schema.sections.some((section) => section.id === id)) return schema;
  const ringRemoved = /^Jackson[\s_-]*(?:Property|P)[\s_-]*0*3$/i.test(name);
  const devices = ringRemoved ? ["Minut"] : ["Ring camera", "Minut"];
  // Only reuse checks visible on every visit. Conditional checks must not hide
  // the mandatory per-clean outcome or leave proof depending on an absent field.
  const existing = schema.sections
    .filter((section) => !section.conditional)
    .flatMap((section) =>
      section.fields
        .filter((field) => !field.conditional)
        .flatMap((field) => [
          field,
          ...(field.children ?? []).filter((child) => !child.conditional),
        ]),
    );
  const reused = new Set<string>();
  const fields: FormField[] = devices.flatMap<FormField>((device) => {
    const prefix = `${id}-${device === "Minut" ? "minut" : "ring"}`;
    const match = existing.find(
      (field) =>
        isDeviceStatusField(field) &&
        (device === "Minut" ? /\bminut\b/i : /\bring\b/i).test(field.label),
    );
    if (match) {
      reused.add(match.id);
      return [
        {
          id: `${prefix}-proof`,
          type: "photo",
          label: `${device} charging proof`,
          required: true,
          minPhotos: 1,
          helpText:
            "Show the device and charging indicator or battery level after charging.",
          conditional: { fieldId: match.id, operator: "equals", value: true },
        },
      ];
    }
    return [
      {
        id: `${prefix}-status`,
        type: "select",
        deviceStatus: false,
        label: `${device} charging outcome`,
        required: true,
        options: ["Charged / charging", "Absent", "Unable to charge"],
      },
      {
        id: `${prefix}-proof`,
        type: "photo",
        label: `${device} charging proof`,
        required: true,
        minPhotos: 1,
        helpText:
          "Show the device and charging indicator or battery level after charging.",
        conditional: {
          fieldId: `${prefix}-status`,
          operator: "equals",
          value: "Charged / charging",
        },
      },
      {
        id: `${prefix}-reason`,
        type: "longtext",
        label: `${device}: explain why charging was not completed`,
        required: true,
        conditional: {
          fieldId: `${prefix}-status`,
          operator: "oneOf",
          value: ["Absent", "Unable to charge"],
        },
      },
    ];
  });
  const update = (field: FormField): FormField => ({
    ...field,
    ...(reused.has(field.id)
      ? {
          required: true,
          helpText:
            "Charge this device on every clean and upload charging proof. If absent or faulty, record the exception and reason.",
        }
      : {}),
    ...(field.children ? { children: field.children.map(update) } : {}),
  });
  return {
    ...schema,
    sections: [
      ...schema.sections.map((section) => ({
        ...section,
        fields: section.fields.map(update),
      })),
      {
        id,
        title: "Device charging",
        description:
          "Charge fitted devices on every clean and upload proof. Record missing or faulty devices honestly.",
        fields,
      },
    ],
  };
}
