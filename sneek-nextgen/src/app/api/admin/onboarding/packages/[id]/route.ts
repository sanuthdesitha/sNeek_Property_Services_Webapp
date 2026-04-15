import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { IntegrationProvider, JobType } from "@prisma/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiRole("ADMIN", "OPS_MANAGER");
  if (session instanceof NextResponse) return session;

  const { id } = await params;

  const pkg = await prisma.onboardingPackage.findUnique({
    where: { id },
    include: {
      survey: {
        include: {
          sections: true,
          photos: true,
          surveyor: { select: { id: true, name: true, email: true } },
          client: { select: { id: true, name: true } },
        },
      },
      items: true,
      approvalLogs: {
        include: { admin: { select: { id: true, name: true } } },
      },
    },
  });

  if (!pkg) return apiError("Package not found", 404);

  return apiSuccess(pkg);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiRole("ADMIN", "OPS_MANAGER");
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const body = await req.json();
  const { action, itemId, editedData } = body;

  const pkg = await prisma.onboardingPackage.findUnique({
    where: { id },
    include: { items: true, survey: true },
  });

  if (!pkg) return apiError("Package not found", 404);

  if (action === "APPROVE_ALL") {
    const results = await provisionPackage(pkg, session.user.id);

    await prisma.onboardingApprovalLog.create({
      data: { packageId: id, action: "APPROVE_ALL", adminId: session.user.id },
    });

    await prisma.onboardingPackage.update({ where: { id }, data: { status: "APPROVED" } });
    await prisma.propertySurvey.update({
      where: { id: pkg.surveyId },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: session.user.id },
    });

    return apiSuccess({ action: "APPROVE_ALL", results });
  }

  if (action === "APPROVE_ITEM" && itemId) {
    await prisma.onboardingItem.update({ where: { id: itemId }, data: { status: "APPROVED" } });
    await prisma.onboardingApprovalLog.create({
      data: { packageId: id, itemId, action: "APPROVE_ITEM", adminId: session.user.id },
    });
    return apiSuccess({ action: "APPROVE_ITEM", itemId });
  }

  if (action === "EDIT_ITEM" && itemId && editedData) {
    await prisma.onboardingItem.update({
      where: { id: itemId },
      data: { data: { ...(pkg.items.find((item: { id: string }) => item.id === itemId)?.data as object ?? {}), ...editedData }, status: "EDITED" },
    });
    await prisma.onboardingApprovalLog.create({
      data: { packageId: id, itemId, action: "EDIT_ITEM", adminId: session.user.id, notes: "Item edited before approval" },
    });
    return apiSuccess({ action: "EDIT_ITEM", itemId });
  }

  if (action === "REJECT_ITEM" && itemId) {
    await prisma.onboardingItem.update({ where: { id: itemId }, data: { status: "REJECTED" } });
    await prisma.onboardingApprovalLog.create({
      data: { packageId: id, itemId, action: "REJECT_ITEM", adminId: session.user.id, notes: body.notes },
    });
    return apiSuccess({ action: "REJECT_ITEM", itemId });
  }

  if (action === "REJECT_ALL") {
    await prisma.onboardingItem.updateMany({ where: { packageId: id }, data: { status: "REJECTED" } });
    await prisma.onboardingApprovalLog.create({
      data: { packageId: id, action: "REJECT_ALL", adminId: session.user.id, notes: body.notes },
    });
    await prisma.onboardingPackage.update({ where: { id }, data: { status: "REJECTED" } });
    await prisma.propertySurvey.update({ where: { id: pkg.surveyId }, data: { status: "REJECTED" } });
    return apiSuccess({ action: "REJECT_ALL" });
  }

  return apiError("Invalid action", 400);
}

async function provisionPackage(
  pkg: { id: string; surveyId: string; items: Array<{ id: string; entityType: string; data: unknown }> },
  adminId: string,
) {
  const results: Record<string, unknown> = {};

  // 1. Create or update client
  const clientItem = pkg.items.find((i: { entityType: string }) => i.entityType === "CLIENT");
  let clientId: string | null = null;

  if (clientItem) {
    const clientData = clientItem.data as Record<string, unknown>;
    const existingClient = await prisma.client.findFirst({
      where: { email: clientData.email as string },
    });

    if (existingClient) {
      clientId = existingClient.id;
      await prisma.client.update({
        where: { id: existingClient.id },
        data: {
          name: (clientData.name as string) ?? undefined,
          phone: (clientData.phone as string) ?? undefined,
          address: (clientData.address as string) ?? undefined,
          notes: (clientData.notes as string) ?? undefined,
        },
      });
    } else {
      const client = await prisma.client.create({
        data: {
          name: (clientData.name as string) ?? "Unknown",
          email: (clientData.email as string) ?? null,
          phone: (clientData.phone as string) ?? null,
          address: (clientData.address as string) ?? null,
          notes: (clientData.notes as string) ?? null,
        },
      });
      clientId = client.id;
      results.clientId = client.id;
    }
  }

  // 2. Create property
  const propertyItem = pkg.items.find((i: { entityType: string }) => i.entityType === "PROPERTY");
  let propertyId: string | undefined;

  if (propertyItem && clientId) {
    const propertyData = propertyItem.data as Record<string, unknown>;
    const property = await prisma.property.create({
      data: {
        clientId,
        name: (propertyData.name as string) ?? "New Property",
        address: (propertyData.address as string) ?? "",
        suburb: (propertyData.suburb as string) ?? "",
        state: (propertyData.state as string) ?? "NSW",
        postcode: propertyData.postcode as string | null,
        bedrooms: (propertyData.bedrooms as number) ?? 1,
        bathrooms: (propertyData.bathrooms as number) ?? 1,
        hasBalcony: (propertyData.hasBalcony as boolean) ?? false,
        latitude: propertyData.latitude as number | null,
        longitude: propertyData.longitude as number | null,
        accessCode: propertyData.accessCode as string | null,
        alarmCode: propertyData.alarmCode as string | null,
        keyLocation: propertyData.keyLocation as string | null,
        accessNotes: propertyData.accessNotes as string | null,
        linenBufferSets: (propertyData.linenBufferSets as number) ?? 0,
        laundryEnabled: (propertyData.laundryEnabled as boolean) ?? true,
        inventoryEnabled: (propertyData.inventoryEnabled as boolean) ?? false,
        defaultCheckinTime: (propertyData.defaultCheckinTime as string) ?? "14:00",
        defaultCheckoutTime: (propertyData.defaultCheckoutTime as string) ?? "10:00",
        preferredCleanerUserId: propertyData.preferredCleanerUserId as string | null,
        notes: propertyData.notes as string | null,
      },
    });
    propertyId = property.id;
    results.propertyId = property.id;
  }

  // 3. Create integration (iCal)
  const integrationItem = pkg.items.find((i: { entityType: string }) => i.entityType === "INTEGRATION");
  if (integrationItem && propertyId) {
    const icalData = integrationItem.data as Record<string, unknown>;
    await prisma.integration.create({
      data: {
        propertyId,
        provider: (icalData.provider as IntegrationProvider) ?? "ICAL_OTHER",
        icalUrl: icalData.icalUrl as string | null,
        isEnabled: (icalData.isEnabled as boolean) ?? false,
      },
    });
    results.integrationCreated = true;
  }

  // 4. Create form templates
  const formTemplateItems = pkg.items.filter((i: { entityType: string }) => i.entityType === "FORM_TEMPLATE");
  for (const item of formTemplateItems) {
    const data = item.data as Record<string, unknown>;
    await prisma.formTemplate.create({
      data: {
        name: `${data.serviceType} Template`,
        serviceType: data.serviceType as JobType,
        schema: { sections: [] },
      },
    });
  }
  results.formTemplatesCreated = formTemplateItems.length;

  // 5. Create property client rates
  const rateItems = pkg.items.filter((i: { entityType: string }) => i.entityType === "PROPERTY_CLIENT_RATE");
  for (const item of rateItems) {
    const data = item.data as Record<string, unknown>;
    if (propertyId && data.serviceType) {
      await prisma.propertyClientRate.create({
        data: { propertyId, jobType: data.serviceType as JobType, baseCharge: 0 },
      });
    }
  }
  results.ratesCreated = rateItems.length;

  // 6. Set up inventory defaults
  const inventoryItem = pkg.items.find((i: { entityType: string }) => i.entityType === "INVENTORY_DEFAULT");
  if (inventoryItem && propertyId) {
    const inventoryData = inventoryItem.data as Record<string, unknown>;
    const defaultItems = inventoryData.items as string[] | undefined;
    if (defaultItems?.length) {
      const items = await prisma.inventoryItem.findMany({ where: { name: { in: defaultItems } } });
      for (const item of items) {
        await prisma.propertyStock.create({
          data: { propertyId, itemId: item.id, onHand: 5, parLevel: 10, reorderThreshold: 3 },
        });
      }
    }
    results.inventoryDefaultsSet = true;
  }

  results.provisionedBy = adminId;
  results.provisionedAt = new Date();

  return results;
}
