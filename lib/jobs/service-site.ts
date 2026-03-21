import { JobType, type PrismaClient } from "@prisma/client";

const FALLBACK_CLIENT_NAME = "Unassigned / One-off Jobs";

export type ServiceSiteInput = {
  clientId?: string;
  jobType: JobType;
  estimatedHours?: number;
  serviceSite: {
    name: string;
    address: string;
    suburb: string;
    state?: string;
    postcode?: string;
    bedrooms?: number;
    bathrooms?: number;
    hasBalcony?: boolean;
  };
  serviceContext?: {
    accessInstructions?: string;
    parkingInstructions?: string;
    hazardNotes?: string;
    equipmentNotes?: string;
    siteContactName?: string;
    siteContactPhone?: string;
    serviceAreaSqm?: number;
    floorCount?: number;
  };
};

function normalizeText(value: string | undefined) {
  return value?.trim() ?? "";
}

async function ensureFallbackClient(db: PrismaClient) {
  const existing = await db.client.findFirst({
    where: { name: FALLBACK_CLIENT_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return db.client.create({
    data: {
      name: FALLBACK_CLIENT_NAME,
      notes: "System fallback client for one-off or non-property jobs.",
      isActive: true,
    },
  });
}

export async function ensureServiceSiteProperty(db: PrismaClient, input: ServiceSiteInput) {
  const name = normalizeText(input.serviceSite.name);
  const address = normalizeText(input.serviceSite.address);
  const suburb = normalizeText(input.serviceSite.suburb);
  if (!name || !address || !suburb) {
    throw new Error("Service site name, address, and suburb are required.");
  }

  const clientId = normalizeText(input.clientId) || (await ensureFallbackClient(db)).id;
  const existing = await db.property.findFirst({
    where: {
      clientId,
      isActive: true,
      name: { equals: name, mode: "insensitive" },
      address: { equals: address, mode: "insensitive" },
      suburb: { equals: suburb, mode: "insensitive" },
    },
    orderBy: { createdAt: "asc" },
  });

  if (existing) return existing;

  const accessInfo = {
    defaultCleanDurationHours:
      input.estimatedHours && Number.isFinite(input.estimatedHours) && input.estimatedHours > 0
        ? Number(input.estimatedHours.toFixed(2))
        : 3,
    parking: normalizeText(input.serviceContext?.parkingInstructions) || undefined,
    instructions: normalizeText(input.serviceContext?.accessInstructions) || undefined,
    other: normalizeText(input.serviceContext?.equipmentNotes) || undefined,
    siteContactName: normalizeText(input.serviceContext?.siteContactName) || undefined,
    siteContactPhone: normalizeText(input.serviceContext?.siteContactPhone) || undefined,
    serviceAreaSqm:
      input.serviceContext?.serviceAreaSqm && Number.isFinite(input.serviceContext.serviceAreaSqm)
        ? Number(input.serviceContext.serviceAreaSqm.toFixed(2))
        : undefined,
    floorCount:
      input.serviceContext?.floorCount && Number.isFinite(input.serviceContext.floorCount)
        ? Math.max(1, Math.round(input.serviceContext.floorCount))
        : undefined,
    serviceSite: true,
    sourceJobType: input.jobType,
  };

  const noteLines = [
    "Auto-created service site for non-Airbnb work.",
    normalizeText(input.serviceContext?.hazardNotes)
      ? `Hazards / safety: ${normalizeText(input.serviceContext?.hazardNotes)}`
      : null,
  ].filter(Boolean);

  return db.property.create({
    data: {
      clientId,
      name,
      address,
      suburb,
      state: normalizeText(input.serviceSite.state) || "NSW",
      postcode: normalizeText(input.serviceSite.postcode) || undefined,
      notes: noteLines.length > 0 ? noteLines.join("\n") : undefined,
      accessInfo,
      linenBufferSets: 0,
      inventoryEnabled: false,
      defaultCheckinTime: "14:00",
      defaultCheckoutTime: "10:00",
      hasBalcony: input.serviceSite.hasBalcony === true,
      bedrooms: input.serviceSite.bedrooms ?? 0,
      bathrooms: input.serviceSite.bathrooms ?? 0,
      integration: { create: { isEnabled: false } },
    },
  });
}
