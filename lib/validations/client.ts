import { z } from "zod";
import {
  optionalAddressSchema,
  optionalEmailSchema,
  optionalAustralianMobileSchema,
  optionalNoteSchema,
  optionalPostcodeSchema,
  requiredAddressSchema,
  requiredAustralianStateSchema,
  requiredSuburbSchema,
} from "@/lib/validations/common";

const accessAttachmentSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  key: z.string().optional(),
  contentType: z.string().optional(),
});

const accessInfoSchema = z.object({
  lockbox: z.string().optional(),
  codes: z.string().optional(),
  parking: z.string().optional(),
  other: z.string().optional(),
  instructions: z.string().optional(),
  defaultCleanDurationHours: z.number().positive().max(24).optional(),
  maxGuestCount: z.number().int().min(1).max(100).optional(),
  laundryTeamUserIds: z.array(z.string().cuid()).optional(),
  attachments: z.array(accessAttachmentSchema).optional(),
});

const inventoryLocationSchema = z.enum(["BATHROOM", "KITCHEN", "CLEANERS_CUPBOARD"]);

/** Colour choices for the property laundry bag swatch picker (stored lowercase). */
export const LAUNDRY_BAG_COLORS = [
  "blue",
  "red",
  "green",
  "yellow",
  "black",
  "white",
  "orange",
  "purple",
] as const;

/** Setup guide entry kinds — mirrors accessGuide's shape/handling. */
export const SETUP_GUIDE_KINDS = ["SETUP", "REFERENCE_POSITION", "SOFA_BED", "OTHER"] as const;

const setupGuideImageSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  key: z.string().trim().min(1).max(1024),
  caption: z.string().trim().max(280).optional(),
});

const setupGuideEntrySchema = z.object({
  id: z.string().trim().min(1).max(64),
  kind: z.enum(SETUP_GUIDE_KINDS),
  label: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(4000).optional(),
  images: z.array(setupGuideImageSchema).max(24).default([]),
});

export const setupGuideSchema = z.array(setupGuideEntrySchema).max(40);

/**
 * Normalise a setupGuide array for persistence — trims empty captions and drops
 * entries with no useful content. Mirrors the access-guide route's cleaning.
 */
export function sanitizeSetupGuide(value: unknown): z.infer<typeof setupGuideEntrySchema>[] {
  if (!Array.isArray(value)) return [];
  const out: z.infer<typeof setupGuideEntrySchema>[] = [];
  for (const raw of value) {
    const parsed = setupGuideEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const entry = parsed.data;
    const cleaned = {
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      instructions: entry.instructions?.trim() || undefined,
      images: entry.images.map((img) => ({
        url: img.url,
        key: img.key,
        caption: img.caption?.trim() || undefined,
      })),
    };
    if (cleaned.label || cleaned.instructions || cleaned.images.length > 0) out.push(cleaned);
  }
  return out;
}

const clientPortalVisibilityOverrideSchema = z
  .object({
    showProperties: z.boolean().optional(),
    showJobs: z.boolean().optional(),
    showCalendar: z.boolean().optional(),
    showReports: z.boolean().optional(),
    showInventory: z.boolean().optional(),
    showShopping: z.boolean().optional(),
    showStockRuns: z.boolean().optional(),
    showFinanceDetails: z.boolean().optional(),
    showOngoingJobs: z.boolean().optional(),
    showCases: z.boolean().optional(),
    showExtraPayRequests: z.boolean().optional(),
    showCleanerNames: z.boolean().optional(),
    showLaundryUpdates: z.boolean().optional(),
    showLaundryImages: z.boolean().optional(),
    showLaundryCosts: z.boolean().optional(),
    showChecklistPreview: z.boolean().optional(),
    showClientTaskRequests: z.boolean().optional(),
    showQuoteRequests: z.boolean().optional(),
    showApprovals: z.boolean().optional(),
    showReportDownloads: z.boolean().optional(),
    allowInventoryThresholdEdits: z.boolean().optional(),
    allowStockRuns: z.boolean().optional(),
    allowCaseReplies: z.boolean().optional(),
  })
  .optional();

export const createClientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required.").max(200, "Client name is too long."),
  email: optionalEmailSchema,
  phone: optionalAustralianMobileSchema,
  address: optionalAddressSchema,
  suburb: z.string().trim().max(120).optional().nullable(),
  state: z.string().trim().max(8).optional().nullable(),
  postcode: optionalPostcodeSchema,
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  placeId: z.string().max(200).optional().nullable(),
  notes: optionalNoteSchema(4000),
  portalVisibilityOverrides: clientPortalVisibilityOverrideSchema,
  sendPortalInvite: z.boolean().optional(),
  welcomeNote: z.string().max(4000).optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const createPropertySchema = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1, "Property name is required.").max(200, "Property name is too long."),
  address: requiredAddressSchema,
  suburb: requiredSuburbSchema,
  state: requiredAustralianStateSchema.default("NSW"),
  postcode: optionalPostcodeSchema,
  imageUrl: z.string().trim().max(2000).optional().nullable(),
  notes: optionalNoteSchema(4000),
  accessInfo: accessInfoSchema.optional(),
  linenBufferSets: z.number().int().min(0).default(0),
  inventoryEnabled: z.boolean().default(false),
  defaultCheckinTime: z.string().regex(/^\d{2}:\d{2}$/).default("14:00"),
  defaultCheckoutTime: z.string().regex(/^\d{2}:\d{2}$/).default("10:00"),
  // Where turnover job start/due times come from: the property's configured
  // default times ("PROPERTY", the default) or the imported iCal event times.
  jobTimeSource: z.enum(["PROPERTY", "ICAL"]).default("PROPERTY"),
  hasBalcony: z.boolean().default(false),
  bedrooms: z.number().int().min(0).default(1),
  bathrooms: z.number().int().min(0).default(1),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  placeId: z.string().max(200).optional().nullable(),
  accessCode: z.string().max(200).optional().nullable(),
  alarmCode: z.string().max(200).optional().nullable(),
  keyLocation: z.string().max(500).optional().nullable(),
  accessNotes: z.string().max(4000).optional().nullable(),
  preferredCleanerUserId: z.string().cuid().optional().nullable(),
  showCleanerContactToClient: z.boolean().optional(),
  laundryEnabled: z.boolean().optional(),
  // ── Quality & accountability config ────────────────────────────────────────
  cleaningDurationMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  cleanerServiceRate: z.number().min(0).max(100000).optional().nullable(),
  laundryBagLabel: z.string().trim().max(120).optional().nullable(),
  laundryBagColor: z.enum(LAUNDRY_BAG_COLORS).optional().nullable(),
  sofaBedCount: z.number().int().min(0).max(20).default(0),
  setupGuide: setupGuideSchema.optional(),
  // Admin-defined custom intake field values — { [customFieldId]: value }.
  // Field definitions live in the propertyFormConfig AppSetting; validated +
  // pruned against that config in the route, so accept an open record here.
  customFields: z.record(z.string(), z.any()).optional(),
  defaultInventoryItemIds: z.array(z.string().cuid()).optional(),
  customInventoryItems: z
    .array(
      z.object({
        name: z.string().min(1),
        category: z.string().min(1).default("Custom"),
        location: inventoryLocationSchema.default("CLEANERS_CUPBOARD"),
        unit: z.string().min(1).default("unit"),
        supplier: z.string().optional(),
        onHand: z.number().min(0).default(0),
        parLevel: z.number().min(0).default(6),
        reorderThreshold: z.number().min(0).default(2),
      })
    )
    .optional(),
});

export const updatePropertySchema = createPropertySchema.partial().omit({ clientId: true });

export const updateIntegrationSchema = z.object({
  icalUrl: z.string().url().optional().nullable(),
  isEnabled: z.boolean().optional(),
  notes: z.string().optional(),
  syncOptions: z
    .object({
      ignorePastDates: z.boolean().optional(),
      autoCreateTurnoverJobs: z.boolean().optional(),
      updateExistingLinkedJobs: z.boolean().optional(),
      verifyFeedDuplicates: z.boolean().optional(),
      verifyExistingJobConflicts: z.boolean().optional(),
    })
    .optional(),
});
