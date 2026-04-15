import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");
  const clientId = searchParams.get("clientId");
  const isActive = searchParams.get("isActive");

  const properties = await prisma.property.findMany({
    where: {
      ...(clientId && { clientId }),
      ...(isActive !== null && { isActive: isActive === "true" }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { address: { contains: search, mode: "insensitive" } },
          { suburb: { contains: search, mode: "insensitive" } },
        ],
      }),
    },
    include: {
      client: { select: { id: true, name: true, email: true } },
      preferredCleaner: { select: { id: true, name: true } },
      integration: { select: { provider: true, isEnabled: true, lastSyncAt: true, syncStatus: true } },
      _count: {
        select: {
          jobs: true,
          laundryTasks: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return apiSuccess({ properties, total: properties.length });
}

export async function POST(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const body = await req.json();

  if (!body.clientId || !body.name || !body.address || !body.suburb) {
    return apiError("clientId, name, address, and suburb are required", 400);
  }

  const property = await prisma.property.create({
    data: {
      clientId: body.clientId,
      name: body.name,
      address: body.address,
      suburb: body.suburb,
      state: body.state ?? "NSW",
      postcode: body.postcode,
      notes: body.notes,
      linenBufferSets: body.linenBufferSets ?? 0,
      inventoryEnabled: body.inventoryEnabled ?? false,
      defaultCheckinTime: body.defaultCheckinTime ?? "14:00",
      defaultCheckoutTime: body.defaultCheckoutTime ?? "10:00",
      hasBalcony: body.hasBalcony ?? false,
      bedrooms: body.bedrooms ?? 1,
      bathrooms: body.bathrooms ?? 1,
      latitude: body.latitude,
      longitude: body.longitude,
      accessCode: body.accessCode,
      alarmCode: body.alarmCode,
      keyLocation: body.keyLocation,
      accessNotes: body.accessNotes,
      preferredCleanerUserId: body.preferredCleanerUserId,
      showCleanerContactToClient: body.showCleanerContactToClient ?? false,
      laundryEnabled: body.laundryEnabled ?? true,
      isActive: body.isActive ?? true,
    },
  });

  return apiSuccess(property);
}
