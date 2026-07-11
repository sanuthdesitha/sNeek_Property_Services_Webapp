import { FormKind, JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings, saveAppSettings } from "@/lib/settings";
import { getChecklistLibrary, type LibraryModule } from "@/lib/checklists/library";
import { ruleApplies, type PropertyForRules } from "@/lib/checklists/features";

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

/**
 * Compose the final FormSchema for one job type from the library + selections.
 * Emits the same section/field shape the existing form engine consumes
 * (checkbox items with reveal instructions, photo items with stamp tags, etc.).
 */
export function composeFormSchema(
  library: LibraryModule[],
  selections: ProfileSelections,
  jobType: JobType
): { sections: unknown[] } {
  const sections: unknown[] = [];
  for (const module of library) {
    const moduleSel = selections.modules[module.key];
    if (!moduleSel?.enabled) continue;
    const fields: unknown[] = [];
    for (const item of module.items) {
      const itemSel = moduleSel.items[item.key];
      if (!itemSel?.enabled) continue;
      if (!itemIncludesJobType(item.jobTypes, itemSel.jobTypes, jobType)) continue;
      const fieldType = item.fieldType || "checkbox";
      // A proof photo only makes sense to append when the task itself isn't
      // already a media/upload field.
      const wantsProofPhoto =
        itemSel.requiresPhoto === true && fieldType !== "photo" && fieldType !== "video" && fieldType !== "file";
      fields.push({
        id: item.key,
        type: fieldType,
        label: item.label,
        required: item.required,
        instructions: item.instructions || undefined,
        ...(item.minPhotos != null ? { minPhotos: item.minPhotos } : {}),
        ...(item.stampTag ? { stampTag: item.stampTag } : {}),
        ...(item.imageUrl || item.videoUrl
          ? {
              references: [
                ...(item.imageUrl ? [{ kind: "image", url: item.imageUrl }] : []),
                ...(item.videoUrl ? [{ kind: "video", url: item.videoUrl }] : []),
              ],
            }
          : {}),
        ...(wantsProofPhoto ? { children: [proofPhotoChildField(item.key, item.label)] } : {}),
      });
    }
    // Custom items attached to this module.
    for (const custom of selections.customItems) {
      if (custom.moduleKey !== module.key) continue;
      if (custom.jobTypes && custom.jobTypes.length > 0 && !custom.jobTypes.includes(jobType)) continue;
      fields.push(customItemField(custom));
    }
    if (fields.length === 0) continue;
    sections.push({
      id: module.key,
      title: module.title,
      description: module.description || undefined,
      fields,
    });
  }

  // Custom items with no module → their own "Property-specific" section.
  const looseCustom = selections.customItems.filter(
    (custom) =>
      (!custom.moduleKey || custom.moduleKey === "custom") &&
      (!custom.jobTypes || custom.jobTypes.length === 0 || custom.jobTypes.includes(jobType))
  );
  if (looseCustom.length > 0) {
    sections.push({
      id: "property-custom",
      title: "Property-specific tasks",
      description: "Extra tasks defined for this property.",
      fields: looseCustom.map((custom) => customItemField(custom)),
    });
  }

  return { sections: withSignoffSection(sections) };
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
    const schema = composeFormSchema(library, selections, jobType);
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
