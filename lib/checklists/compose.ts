import { FormKind, JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings, saveAppSettings } from "@/lib/settings";
import { getChecklistLibrary, type LibraryModule } from "@/lib/checklists/library";
import { ruleApplies, type PropertyForRules } from "@/lib/checklists/features";
import { EXCEPTION_DEFS, REPORTED_EXCEPTIONS_FIELD_ID } from "@/lib/checklists/catalog";

/**
 * Optional per-composition context for evidence-frequency handling:
 *  - `rotationDue`: `{ itemKey → due }` — ROTATIONAL items are included only
 *    when their key is present and true. An absent map excludes ALL rotational
 *    items (so preview / legacy callers aren't spammed).
 *  - `activeConditionKeys`: exception keys that are already active (e.g.
 *    QA-triggered) — matching CONDITIONAL items render unconditionally + required
 *    instead of hidden behind the reported-exceptions field.
 */
export interface ComposeOptions {
  rotationDue?: Record<string, boolean>;
  activeConditionKeys?: string[];
}

/** Human label for an exception key (falls back to the key itself). */
function exceptionLabel(conditionKey: string): string {
  return EXCEPTION_DEFS.find((d) => d.key === conditionKey)?.label ?? conditionKey;
}

/**
 * Per-property checklist composition:
 *   library (modules/items) + property attributes/features + profile selections
 *     → resolved checklist (for the editor/preview)
 *     → materialised FormTemplate(s) on approval (registered as the property's
 *       form override, so the existing job-form pipeline picks them up).
 */

// ── Profile selections shape (PropertyChecklistProfile.selections) ─────────

export interface ProfileItemSelection {
  enabled: boolean;
  /** Optional per-item override of which job types include it (default = library). */
  jobTypes?: JobType[];
  /** When true, the cleaner must attach a proof photo for this task before submit. */
  requiresPhoto?: boolean;
}

export interface ProfileModuleSelection {
  enabled: boolean;
  items: Record<string, ProfileItemSelection>;
}

export interface ProfileCustomItem {
  id: string;
  /** Attach to a module's section, or "custom" for the Custom section. */
  moduleKey?: string;
  label: string;
  instructions?: string;
  fieldType?: string;
  jobTypes?: JobType[];
  /** When true, the cleaner must attach a proof photo for this task before submit. */
  requiresPhoto?: boolean;
  /** Optional reference image (shown to the cleaner as a thumbnail + lightbox). */
  imageUrl?: string;
}

export interface ProfileSelections {
  modules: Record<string, ProfileModuleSelection>;
  customItems: ProfileCustomItem[];
}

export function sanitizeSelections(raw: unknown): ProfileSelections {
  const out: ProfileSelections = { modules: {}, customItems: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const root = raw as Record<string, unknown>;
  const modules = root.modules;
  if (modules && typeof modules === "object" && !Array.isArray(modules)) {
    for (const [moduleKey, rawSel] of Object.entries(modules as Record<string, unknown>)) {
      if (!rawSel || typeof rawSel !== "object") continue;
      const sel = rawSel as Record<string, unknown>;
      const items: Record<string, ProfileItemSelection> = {};
      if (sel.items && typeof sel.items === "object" && !Array.isArray(sel.items)) {
        for (const [itemKey, rawItem] of Object.entries(sel.items as Record<string, unknown>)) {
          if (!rawItem || typeof rawItem !== "object") continue;
          const item = rawItem as Record<string, unknown>;
          const jobTypes = Array.isArray(item.jobTypes)
            ? (item.jobTypes.filter((jt) => Object.values(JobType).includes(jt as JobType)) as JobType[])
            : undefined;
          items[itemKey] = {
            enabled: item.enabled === true,
            ...(jobTypes ? { jobTypes } : {}),
            ...(item.requiresPhoto === true ? { requiresPhoto: true } : {}),
          };
        }
      }
      out.modules[moduleKey] = { enabled: sel.enabled === true, items };
    }
  }
  if (Array.isArray(root.customItems)) {
    for (const rawItem of root.customItems) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as Record<string, unknown>;
      const label = typeof item.label === "string" ? item.label.trim() : "";
      if (!label) continue;
      const jobTypes = Array.isArray(item.jobTypes)
        ? (item.jobTypes.filter((jt) => Object.values(JobType).includes(jt as JobType)) as JobType[])
        : undefined;
      out.customItems.push({
        id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `custom-${out.customItems.length + 1}`,
        moduleKey: typeof item.moduleKey === "string" ? item.moduleKey : undefined,
        label,
        instructions: typeof item.instructions === "string" ? item.instructions.trim() || undefined : undefined,
        fieldType: typeof item.fieldType === "string" ? item.fieldType : undefined,
        ...(jobTypes ? { jobTypes } : {}),
        ...(item.requiresPhoto === true ? { requiresPhoto: true } : {}),
        ...(typeof item.imageUrl === "string" && item.imageUrl.trim()
          ? { imageUrl: item.imageUrl.trim() }
          : {}),
      });
    }
  }
  return out;
}

// ── Default selections from the library + property attributes ──────────────

/**
 * Build the DEFAULT profile selections for a property: a module is on when its
 * appliesWhen rule matches (or has no rule); an item is on when the module is
 * on, the item's own rule matches, and it's defaultOn.
 */
export function buildDefaultSelections(
  library: LibraryModule[],
  property: PropertyForRules
): ProfileSelections {
  const selections: ProfileSelections = { modules: {}, customItems: [] };
  for (const module of library) {
    const moduleApplies = ruleApplies(module.appliesWhen, property);
    const items: Record<string, ProfileItemSelection> = {};
    for (const item of module.items) {
      const itemApplies = ruleApplies(item.appliesWhen, property);
      items[item.key] = { enabled: moduleApplies && itemApplies && item.defaultOn };
    }
    selections.modules[module.key] = { enabled: moduleApplies, items };
  }
  return selections;
}

/** Merge saved selections over defaults so new library items appear sensibly. */
export function mergeSelections(
  defaults: ProfileSelections,
  saved: ProfileSelections
): ProfileSelections {
  const merged: ProfileSelections = { modules: {}, customItems: saved.customItems };
  const moduleKeys = new Set([...Object.keys(defaults.modules), ...Object.keys(saved.modules)]);
  for (const moduleKey of Array.from(moduleKeys)) {
    const def = defaults.modules[moduleKey];
    const sav = saved.modules[moduleKey];
    const items: Record<string, ProfileItemSelection> = { ...(def?.items ?? {}) };
    for (const [itemKey, sel] of Object.entries(sav?.items ?? {})) {
      items[itemKey] = sel;
    }
    merged.modules[moduleKey] = { enabled: sav ? sav.enabled : def?.enabled ?? false, items };
  }
  return merged;
}

// ── Resolved checklist → FormSchema per job type ────────────────────────────

function itemIncludesJobType(
  libraryJobTypes: JobType[],
  override: JobType[] | undefined,
  jobType: JobType
): boolean {
  const effective = override ?? libraryJobTypes;
  // Empty jobTypes on a library item = applies to ALL job types.
  if (!effective || effective.length === 0) return true;
  return effective.includes(jobType);
}

/**
 * A required proof-photo sub-field for a task flagged `requiresPhoto`. Attached
 * as a child of the task's checkbox field and shown + required only once the
 * task is ticked done — reusing the form engine's conditional-visibility +
 * required-upload validation (collectRequiredUploadFields) rather than inventing
 * a new mechanism.
 */
function proofPhotoChildField(parentId: string, label: string) {
  return {
    id: `${parentId}__proof`,
    type: "photo",
    label: `Proof photo — ${label}`,
    required: true,
    minPhotos: 1,
    stampTag: "after",
    conditional: { fieldId: parentId, operator: "equals", value: true },
  };
}

/** Recursively test whether a field (or any of its children) matches `pred`. */
function anyFieldDeep(fields: unknown, pred: (field: any) => boolean): boolean {
  if (!Array.isArray(fields)) return false;
  return fields.some((field: any) => {
    if (pred(field)) return true;
    return anyFieldDeep(field?.children, pred);
  });
}

/**
 * Stable "Arrival evidence" section prepended to every generated / legacy job
 * form: a required arrival walkthrough video + a required set of "before" photos.
 * Ids are deterministic (never per-request random) so cleaner drafts keyed by
 * field id survive form reloads / runtime re-injection.
 */
function arrivalEvidenceSection() {
  return {
    id: "arrival-evidence",
    title: "Arrival evidence",
    description: "Capture the state of the property on arrival, before any work begins.",
    fields: [
      {
        id: "arrival-evidence.walkthrough-video",
        type: "video",
        label: "Arrival walkthrough video",
        required: true,
        instructions:
          "Record a short walkthrough capturing the property state as you find it on arrival.",
        maxDurationSec: 120,
      },
      {
        id: "arrival-evidence.before-photos",
        type: "photo",
        label: "Before photos",
        required: true,
        minPhotos: 3,
        stampTag: "before",
        instructions:
          "Take clear before photos covering the key areas (kitchen, bathrooms, living/bedrooms) as they were on arrival.",
      },
    ],
  };
}

/**
 * The shared "Report an exception" section: a multiselect where the cleaner
 * flags anything unusual. CONDITIONAL evidence items reveal themselves off the
 * options selected here. Deterministic ids so drafts survive form reloads.
 */
function exceptionsReportSection() {
  return {
    id: "reported-exceptions-section",
    title: "Report an exception",
    description:
      "Flag anything unusual you encountered on this clean. Selecting an item reveals a short evidence capture for it.",
    fields: [
      {
        id: REPORTED_EXCEPTIONS_FIELD_ID,
        type: "multiselect",
        label: "Did you encounter any of these?",
        required: false,
        instructions:
          "Select all that apply. Each selection reveals a photo-evidence field so the exception is documented.",
        options: EXCEPTION_DEFS.map((d) => d.label),
      },
    ],
  };
}

/**
 * Prepend the standard "Arrival evidence" section, insert the shared "Report an
 * exception" section, and append the sign-off.
 *
 * - Arrival evidence is skipped (idempotent) when the schema already carries any
 *   UNCONDITIONAL `video` field OR `photo` field with stampTag "before" (top-
 *   level or nested) — so rework forms and templates that already gather arrival
 *   media aren't doubled up. Conditional fields (e.g. a hidden
 *   qa_rectification_before photo) are ignored so they don't suppress arrival
 *   evidence.
 * - The exception-report section is skipped when a `reported-exceptions` field
 *   already exists.
 * - Sign-off reuses `withSignoffSection` (skipped when a signature already
 *   exists), keeping it last.
 * - An empty schema stays empty (no sections in → no sections out).
 *
 * Opt-out: pass `{ standardSections: false }` (threaded from a stored
 * `schema.standardSections === false`) and NOTHING is injected — the template
 * already owns baked-in copies of these sections and edits to them must stick.
 * `undefined`/`true` keep the historical behaviour so un-migrated templates
 * never lose their evidence gates.
 */
export function withStandardSections(
  sections: unknown[],
  options?: { standardSections?: boolean }
): unknown[] {
  if (options?.standardSections === false) return sections;
  if (sections.length === 0) return sections;
  const hasArrivalEvidence = sections.some((section: any) =>
    anyFieldDeep(
      section?.fields,
      (field) =>
        !field?.conditional &&
        (field?.type === "video" ||
          (field?.type === "photo" && field?.stampTag === "before"))
    )
  );
  const withArrival = hasArrivalEvidence
    ? sections
    : [arrivalEvidenceSection(), ...sections];

  const hasExceptionsField = withArrival.some((section: any) =>
    anyFieldDeep(section?.fields, (field) => field?.id === REPORTED_EXCEPTIONS_FIELD_ID)
  );
  const withExceptions = hasExceptionsField
    ? withArrival
    : [...withArrival, exceptionsReportSection()];

  return withSignoffSection(withExceptions);
}

/**
 * Append a signature "Sign-off" section to a checklist→form composition unless
 * one already exists. Only ever adds to freshly generated schemas (skipped when
 * there are no real sections), so existing/hand-built templates are untouched.
 */
export function withSignoffSection(sections: unknown[]): unknown[] {
  if (sections.length === 0) return sections;
  const hasSignature = sections.some(
    (section: any) =>
      Array.isArray(section?.fields) &&
      section.fields.some(
        (field: any) =>
          field?.type === "signature" ||
          (Array.isArray(field?.children) &&
            field.children.some((child: any) => child?.type === "signature"))
      )
  );
  if (hasSignature) return sections;
  return [
    ...sections,
    {
      id: "sign-off",
      title: "Sign-off",
      description: "Confirm the work above has been completed to standard.",
      fields: [
        {
          id: "signoff-signature",
          type: "signature",
          label: "Cleaner sign-off signature",
          required: true,
        },
      ],
    },
  ];
}

/** How many times a module repeats, from its `repeatBy` + the property counts. */
function repeatCountFor(repeatBy: string | null | undefined, property?: PropertyForRules): number {
  if (!repeatBy || !property) return 1;
  if (repeatBy === "bedrooms") return Math.max(1, Number(property.bedrooms ?? 1) || 1);
  if (repeatBy === "bathrooms") return Math.max(1, Number(property.bathrooms ?? 1) || 1);
  return 1;
}

/** Build one library item → form field, with an optional id suffix for repeats. */
function libraryItemField(
  item: LibraryModule["items"][number],
  requiresPhoto: boolean,
  idSuffix: string,
  opts?: { activeConditionKeys?: string[] }
) {
  const fieldId = `${item.key}${idSuffix}`;
  const fieldType = item.fieldType || "checkbox";
  // A proof photo only makes sense when the task itself isn't already a
  // media/upload field.
  const wantsProofPhoto =
    requiresPhoto && fieldType !== "photo" && fieldType !== "video" && fieldType !== "file";

  // ── Evidence frequency (Accountability Phase 1a) ──────────────────────────
  const frequency = (item as any).frequency ?? "EVERY_CLEAN";
  const conditionKey = (item as any).conditionKey as string | null | undefined;
  const isConditional = frequency === "CONDITIONAL" && !!conditionKey;
  // QA-triggered exception keys force the item visible + required; otherwise a
  // conditional item stays hidden until the cleaner reports the exception.
  const qaActive = isConditional && (opts?.activeConditionKeys?.includes(conditionKey!) ?? false);
  const maxPhotos = (item as any).maxPhotos as number | null | undefined;
  const severity = (item as any).severity as string | null | undefined;
  const evidenceCategory = (item as any).evidenceCategory as string | null | undefined;

  return {
    id: fieldId,
    type: fieldType,
    label: item.label,
    required: qaActive ? true : item.required,
    instructions: item.instructions || undefined,
    ...(item.minPhotos != null ? { minPhotos: item.minPhotos } : {}),
    ...(maxPhotos != null ? { maxFiles: maxPhotos } : {}),
    ...(item.stampTag ? { stampTag: item.stampTag } : {}),
    ...(severity ? { severity } : {}),
    ...(evidenceCategory ? { evidenceCategory } : {}),
    // Emit non-default frequency so the submitted schema snapshot is
    // self-describing (the cleaner-submit route derives rotational completion
    // from ROTATIONAL fields). EVERY_CLEAN fields stay byte-identical to before.
    ...(frequency && frequency !== "EVERY_CLEAN" ? { frequency } : {}),
    ...(item.imageUrl || item.videoUrl
      ? {
          references: [
            ...(item.imageUrl ? [{ kind: "image", url: item.imageUrl }] : []),
            ...(item.videoUrl ? [{ kind: "video", url: item.videoUrl }] : []),
          ],
        }
      : {}),
    // CONDITIONAL: reveal only when the cleaner selects the matching exception
    // on the shared reported-exceptions field. QA-active items skip the gate.
    ...(isConditional && !qaActive
      ? {
          conditional: {
            fieldId: REPORTED_EXCEPTIONS_FIELD_ID,
            operator: "oneOf",
            value: [exceptionLabel(conditionKey!)],
          },
        }
      : {}),
    ...(wantsProofPhoto ? { children: [proofPhotoChildField(fieldId, item.label)] } : {}),
  };
}

/**
 * A minimal guaranteed section so every SELECTED service composes to ≥1 section
 * (and therefore always materialises a form). Only used as a safety net when a
 * job type's modules/items all resolve away — real service content, when
 * present, takes precedence and this is skipped.
 */
function baselineServiceSection() {
  const field = (id: string, label: string, instructions: string) => ({
    id,
    type: "checkbox",
    label,
    required: true,
    instructions,
  });
  return {
    id: "service-baseline",
    title: "Service access & completion",
    description: "Baseline checks to confirm the booked service was carried out.",
    fields: [
      field(
        "service.access",
        "Confirmed safe access to the property / work area",
        "Confirm you have safe, authorised access to the areas in scope before starting."
      ),
      field(
        "service.scope",
        "Confirmed the agreed scope of work",
        "Check the booking notes and confirm the specific tasks and priorities for this visit."
      ),
      field(
        "service.complete",
        "Completed the agreed service to standard",
        "Work through the agreed tasks methodically and check the result against the brief."
      ),
      field(
        "service.tidy",
        "Cleared equipment and left the area tidy",
        "Remove your equipment and any waste generated and leave the area clean and presentable."
      ),
    ],
  };
}

/**
 * Compose the final FormSchema for one job type from the library + selections.
 * Emits the same section/field shape the existing form engine consumes
 * (checkbox items with reveal instructions, photo items with stamp tags, etc.).
 *
 * `property` (optional) enables per-room repetition (module.repeatBy) and is
 * threaded through by generatePropertyTemplates; callers that omit it get
 * today's single-section-per-module behaviour.
 */
export function composeFormSchema(
  library: LibraryModule[],
  selections: ProfileSelections,
  jobType: JobType,
  property?: PropertyForRules,
  options?: ComposeOptions
): { sections: unknown[] } {
  const sections: unknown[] = [];
  const emittedCustomModuleKeys = new Set<string>();
  const rotationDue = options?.rotationDue;
  const activeConditionKeys = options?.activeConditionKeys;

  for (const module of library) {
    const moduleSel = selections.modules[module.key];
    if (!moduleSel?.enabled) continue;

    const repeatCount = repeatCountFor(module.repeatBy, property);
    const unitLabel = module.repeatBy === "bathrooms" ? "Bathroom" : "Bedroom";

    for (let n = 1; n <= repeatCount; n++) {
      const repeated = repeatCount > 1;
      // Keep field ids identical to today for the single (non-repeated) case so
      // existing properties/templates are unaffected; only suffix on repeats.
      const idSuffix = repeated ? `__${module.repeatBy === "bathrooms" ? "bath" : "bed"}${n}` : "";
      const fields: unknown[] = [];
      for (const item of module.items) {
        const itemSel = moduleSel.items[item.key];
        if (!itemSel?.enabled) continue;
        if (!itemIncludesJobType(item.jobTypes, itemSel.jobTypes, jobType)) continue;
        // ROTATIONAL items only appear when the due-map says so. No map (preview
        // / legacy / static-template callers) → excluded so they aren't spammed.
        const frequency = (item as any).frequency ?? "EVERY_CLEAN";
        if (frequency === "ROTATIONAL" && rotationDue?.[item.key] !== true) continue;
        fields.push(
          libraryItemField(item, itemSel.requiresPhoto === true, idSuffix, { activeConditionKeys })
        );
      }
      // Custom items attached to this module — only on the first block so they
      // aren't duplicated across repeated rooms.
      if (n === 1) {
        for (const custom of selections.customItems) {
          if (custom.moduleKey !== module.key) continue;
          if (custom.jobTypes && custom.jobTypes.length > 0 && !custom.jobTypes.includes(jobType)) continue;
          fields.push(customItemField(custom));
        }
      }
      if (fields.length === 0) continue;
      emittedCustomModuleKeys.add(module.key);
      sections.push({
        id: repeated ? `${module.key}-${n}` : module.key,
        title: repeated ? `${unitLabel} ${n}` : module.title,
        description: module.description || undefined,
        fields,
      });
    }
  }

  // Custom items with no module, or attached to a module that didn't render
  // (disabled/absent for this property or job type) → gathered into their own
  // "Property-specific" section so an injected special request is never lost.
  const looseCustom = selections.customItems.filter((custom) => {
    if (custom.jobTypes && custom.jobTypes.length > 0 && !custom.jobTypes.includes(jobType)) return false;
    if (!custom.moduleKey || custom.moduleKey === "custom") return true;
    return !emittedCustomModuleKeys.has(custom.moduleKey);
  });
  if (looseCustom.length > 0) {
    sections.push({
      id: "property-custom",
      title: "Property-specific tasks",
      description: "Extra tasks defined for this property.",
      fields: looseCustom.map((custom) => customItemField(custom)),
    });
  }

  // No selected service should be left without a form: fall back to a baseline
  // access/scope/completion section when nothing else resolved.
  if (sections.length === 0) {
    sections.push(baselineServiceSection());
  }

  return { sections: withStandardSections(sections) };
}

/** A custom checklist item → form field, with optional proof photo + reference image. */
function customItemField(custom: ProfileCustomItem) {
  const id = `custom.${custom.id}`;
  const fieldType = custom.fieldType || "checkbox";
  const wantsProofPhoto =
    custom.requiresPhoto === true && fieldType !== "photo" && fieldType !== "video" && fieldType !== "file";
  return {
    id,
    type: fieldType,
    label: custom.label,
    required: false,
    instructions: custom.instructions || undefined,
    ...(custom.imageUrl ? { references: [{ kind: "image", url: custom.imageUrl }] } : {}),
    ...(wantsProofPhoto ? { children: [proofPhotoChildField(id, custom.label)] } : {}),
  };
}

// ── Materialise: profile → FormTemplate(s) + property override registration ─

export async function generatePropertyTemplates(params: {
  propertyId: string;
  jobTypes: JobType[];
  actorUserId: string;
}): Promise<{ generated: Partial<Record<JobType, string>> }> {
  const property = await db.property.findUnique({
    where: { id: params.propertyId },
    select: {
      id: true,
      name: true,
      hasBalcony: true,
      bedrooms: true,
      bathrooms: true,
      laundryEnabled: true,
      inventoryEnabled: true,
      sofaBedCount: true,
      features: true,
      checklistProfile: true,
    },
  });
  if (!property) throw new Error("Property not found.");
  const profile = property.checklistProfile;
  if (!profile) throw new Error("No checklist profile saved for this property yet.");

  const library = await getChecklistLibrary();
  const defaults = buildDefaultSelections(library, property);
  const selections = mergeSelections(defaults, sanitizeSelections(profile.selections));

  const previousIds =
    profile.generatedTemplateIds && typeof profile.generatedTemplateIds === "object"
      ? (profile.generatedTemplateIds as Record<string, string>)
      : {};
  const generated: Partial<Record<JobType, string>> = {};

  for (const jobType of params.jobTypes) {
    const schema = composeFormSchema(library, selections, jobType, property);
    if (schema.sections.length === 0) continue;
    const previousId = previousIds[jobType];
    const previous = previousId
      ? await db.formTemplate.findUnique({ where: { id: previousId }, select: { id: true, version: true } })
      : null;

    const template = await db.formTemplate.create({
      data: {
        name: `${property.name} — ${jobType.replace(/_/g, " ").toLowerCase()} checklist`,
        serviceType: jobType,
        kind: FormKind.CUSTOM,
        version: (previous?.version ?? 0) + 1,
        isActive: true,
        schema: schema as any,
        parentTemplateId: previous?.id ?? null,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    generated[jobType] = template.id;

    // Retire the previous generated version so it stops appearing as selectable
    // (past jobs are unaffected — reports snapshot __templateSchema).
    if (previous) {
      await db.formTemplate.update({
        where: { id: previous.id },
        data: { isActive: false, archivedAt: new Date() },
      });
    }
  }

  // Register the generated templates as THIS property's per-job-type overrides
  // (the existing job-form pipeline already resolves these).
  const settings = await getAppSettings();
  const overrides = { ...(settings.propertyFormTemplateOverrides ?? {}) };
  const forProperty: Partial<Record<JobType, string>> = {
    ...(overrides[params.propertyId] ?? {}),
  };
  for (const [jobType, templateId] of Object.entries(generated)) {
    forProperty[jobType as JobType] = templateId;
  }
  overrides[params.propertyId] = forProperty;
  await saveAppSettings({ propertyFormTemplateOverrides: overrides });

  await db.propertyChecklistProfile.update({
    where: { propertyId: params.propertyId },
    data: {
      status: "APPROVED",
      approvedById: params.actorUserId,
      approvedAt: new Date(),
      generatedTemplateIds: { ...previousIds, ...generated } as any,
    },
  });

  await db.auditLog.create({
    data: {
      userId: params.actorUserId,
      action: "PROPERTY_CHECKLIST_APPROVED",
      entity: "Property",
      entityId: params.propertyId,
      after: { generated } as any,
    },
  });

  return { generated };
}
