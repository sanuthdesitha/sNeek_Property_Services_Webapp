import "server-only";
import { createHash } from "node:crypto";

export interface FormRevisionInput {
  /** Server-resolved identifier; may identify a virtual form, not proof of a DB FK. */
  templateId: string;
  /** Final assembleJobForm output, before or after reference signing. */
  schema: unknown;
  validationContext: {
    jobType: string;
    isRework: boolean;
    laundryEligible: boolean;
    canUseNoPhoto: boolean;
    requiredChecklistTicksBlockSubmit: boolean;
    selfInspectionBlocksSubmit: boolean;
    /**
     * Explicit JSON-only property projection, NOT a raw Prisma Property.
     * Include hasBalcony and every section/field/child conditional.propertyField
     * value, using literal keys (no dotted-path expansion), exactly as visibility
     * reads property[key]. Omit missing/undefined values. Unrelated JSON values
     * are ignored, but Date/Decimal/toJSON values anywhere are rejected.
     */
    property: Record<string, unknown>;
    /** Resolved server acknowledgement contract, not the cleaner's acknowledgements. */
    finalCheckupItems: readonly unknown[];
  };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectJson = { [key: string]: Json };
const object = (value: Json | undefined): value is ObjectJson =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Match response JSON's omission of undefined OBJECT properties only. Never
// invoke getters/toJSON or coerce malformed array entries into null.
function jsonCopy(value: unknown, ancestors = new Set<object>()): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) throw new TypeError("Invalid form revision JSON");
  if (ancestors.has(value)) throw new TypeError("Cyclic form revision JSON");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) {
    throw new TypeError("Non-plain form revision JSON");
  }
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as string];
      if (typeof key !== "string" || !("value" in descriptor) ||
          (!descriptor.enumerable && !(array && key === "length"))) {
        throw new TypeError("Invalid form revision JSON property");
      }
    }
    if (array) {
      if (Object.keys(descriptors).length !== value.length + 1) throw new TypeError("Sparse or extended JSON array");
      return Array.from({ length: value.length }, (_, index) => {
        if (!Object.hasOwn(descriptors, String(index))) throw new TypeError("Sparse JSON array");
        return jsonCopy(descriptors[String(index)].value, ancestors);
      });
    }
    const result: ObjectJson = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      if (descriptors[key].value !== undefined) result[key] = jsonCopy(descriptors[key].value, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/**
 * Server-owned v1 SHA256 contract fingerprint, not authorization or durable-save
 * proof. Answers, upload counts and laundry answers are state, not contract.
 * Separate submit gates (GPS, assignment, task completion) are not bound here.
 */
export function formRevision(input: FormRevisionInput): string {
  // Validate even excluded presentation/transport values before projection.
  const copied = jsonCopy(input);
  if (!object(copied) || typeof copied.templateId !== "string" || !copied.templateId.trim() ||
      !object(copied.schema) || !Array.isArray(copied.schema.sections) || !object(copied.validationContext)) {
    throw new TypeError("Invalid form revision contract");
  }
  const schema = copied.schema;
  const context = copied.validationContext;
  for (const key of ["isRework", "laundryEligible", "canUseNoPhoto", "requiredChecklistTicksBlockSubmit", "selfInspectionBlocksSubmit"]) {
    if (typeof context[key] !== "boolean") throw new TypeError(`Missing form revision context: ${key}`);
  }
  if (typeof context.jobType !== "string" || !context.jobType.trim() ||
      !object(context.property) || !Array.isArray(context.finalCheckupItems)) throw new TypeError("Invalid form revision context");

  const dependencies = new Set(["hasBalcony"]);
  function visit(node: Json, field: boolean) {
    if (!object(node)) return;
    if (object(node.conditional) && Object.hasOwn(node.conditional, "propertyField")) {
      if (typeof node.conditional.propertyField !== "string") throw new TypeError("Invalid property condition");
      dependencies.add(node.conditional.propertyField);
    }
    if (field && Array.isArray(node.references)) {
      for (const ref of node.references) {
        if (object(ref) && typeof ref.storageKey === "string" && ref.storageKey.trim()) delete ref.url;
      }
    }
    const children = field ? node.children : node.fields;
    if (Array.isArray(children)) children.forEach(child => visit(child, true));
  }
  (schema.sections as Json[]).forEach(section => visit(section, false));
  // FormTheme's known appearance-only keys. Unknown theme/root keys remain
  // conservative contract inputs; never recursively strip arbitrary url keys.
  if (object(schema.theme)) {
    for (const key of ["accentColor", "headerColor", "logoUrl", "logoKey", "showDividers", "headingFont", "bodyFont"]) delete schema.theme[key];
    if (Object.keys(schema.theme).length === 0) delete schema.theme;
  }
  const property: ObjectJson = Object.create(null);
  for (const key of Array.from(dependencies)) {
    if (Object.hasOwn(context.property, key)) property[key] = context.property[key];
  }
  context.property = property;
  return createHash("sha256").update(canonical(["cleaner-form-revision-v1", copied.templateId, schema, context])).digest("hex");
}
