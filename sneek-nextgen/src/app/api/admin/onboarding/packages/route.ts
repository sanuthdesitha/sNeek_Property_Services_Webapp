import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("ADMIN", "OPS_MANAGER");
  if (session instanceof NextResponse) return session;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const packages = await prisma.onboardingPackage.findMany({
    where: {
      ...(status && { status: status as never }),
    },
    include: {
      survey: {
        include: {
          surveyor: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
      },
      items: true,
      _count: { select: { approvalLogs: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ packages, total: packages.length });
}

export async function POST(req: NextRequest) {
  const session = await requireApiRole("ADMIN", "OPS_MANAGER");
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const { surveyId } = body;

  if (!surveyId) {
    return apiError("surveyId is required", 400);
  }

  // Get all survey sections
  const survey = await prisma.propertySurvey.findUnique({
    where: { id: surveyId },
    include: { sections: true, estimations: true, checklists: true },
  });

  if (!survey) return apiError("Survey not found", 404);

  // Build the onboarding package items from survey data
  const items: Array<{ entityType: "CLIENT" | "PROPERTY" | "INTEGRATION" | "FORM_TEMPLATE" | "PRICE_BOOK_ENTRY" | "PROPERTY_CLIENT_RATE" | "JOB_SCHEDULE" | "JOB" | "INVENTORY_DEFAULT" | "LAUNDRY_SETTING"; data: Record<string, unknown> }> = [];

  const clientSection = survey.sections.find((s) => s.sectionKey === "CLIENT");
  const propertySection = survey.sections.find((s) => s.sectionKey === "PROPERTY");
  const icalSection = survey.sections.find((s) => s.sectionKey === "ICAL");
  const servicesSection = survey.sections.find((s) => s.sectionKey === "SERVICES");
  const pricingSection = survey.sections.find((s) => s.sectionKey === "PRICING");

  if (clientSection?.data) {
    const clientData = clientSection.data as Record<string, unknown>;
    items.push({
      entityType: "CLIENT",
      data: {
        name: clientData.name,
        email: clientData.email,
        phone: clientData.phone,
        address: clientData.address,
        notes: clientData.notes,
      },
    });
  }

  if (propertySection?.data) {
    const propertyData = propertySection.data as Record<string, unknown>;
    items.push({
      entityType: "PROPERTY",
      data: {
        name: propertyData.name,
        address: propertyData.address,
        suburb: propertyData.suburb,
        state: propertyData.state ?? "NSW",
        postcode: propertyData.postcode,
        bedrooms: propertyData.bedrooms ?? 1,
        bathrooms: propertyData.bathrooms ?? 1,
        hasBalcony: propertyData.hasBalcony ?? false,
        latitude: propertyData.latitude,
        longitude: propertyData.longitude,
        accessCode: propertyData.accessCode,
        alarmCode: propertyData.alarmCode,
        keyLocation: propertyData.keyLocation,
        accessNotes: propertyData.accessNotes,
        linenBufferSets: propertyData.linenBufferSets ?? 0,
        laundryEnabled: propertyData.laundryEnabled ?? true,
        inventoryEnabled: propertyData.inventoryEnabled ?? false,
        defaultCheckinTime: propertyData.defaultCheckinTime ?? "14:00",
        defaultCheckoutTime: propertyData.defaultCheckoutTime ?? "10:00",
        preferredCleanerUserId: propertyData.preferredCleanerUserId,
        notes: propertyData.notes,
      },
    });
  }

  if (icalSection?.data) {
    const icalData = icalSection.data as Record<string, unknown>;
    items.push({
      entityType: "INTEGRATION",
      data: {
        provider: icalData.provider ?? "ICAL_OTHER",
        icalUrl: icalData.icalUrl,
        isEnabled: true,
      },
    });
  }

  if (servicesSection?.data) {
    const servicesData = servicesSection.data as Record<string, unknown>;
    const primaryType = servicesData.primaryType as string;
    const addonTypes = servicesData.addonTypes as string[] | undefined;

    if (primaryType) {
      items.push({
        entityType: "FORM_TEMPLATE",
        data: { serviceType: primaryType },
      });
      items.push({
        entityType: "PRICE_BOOK_ENTRY",
        data: { serviceType: primaryType },
      });
      items.push({
        entityType: "PROPERTY_CLIENT_RATE",
        data: { serviceType: primaryType },
      });
    }

    if (addonTypes?.length) {
      for (const addonType of addonTypes) {
        items.push({
          entityType: "FORM_TEMPLATE",
          data: { serviceType: addonType },
        });
        items.push({
          entityType: "PRICE_BOOK_ENTRY",
          data: { serviceType: addonType },
        });
      }
    }

    if (servicesData.frequency && servicesData.frequency !== "one-time") {
      items.push({
        entityType: "JOB_SCHEDULE",
        data: {
          primaryType,
          addonTypes,
          frequency: servicesData.frequency,
          startDate: servicesData.startDate,
          endDate: servicesData.endDate,
        },
      });
    }
  }

  if (pricingSection?.data) {
    const pricingData = pricingSection.data as Record<string, unknown>;
    items.push({
      entityType: "PROPERTY_CLIENT_RATE",
      data: {
        rates: pricingData.rates,
        paymentTerms: pricingData.paymentTerms,
        discountCode: pricingData.discountCode,
      },
    });
  }

  if (propertySection?.data && (propertySection.data as Record<string, unknown>).laundryEnabled) {
    items.push({
      entityType: "LAUNDRY_SETTING",
      data: {
        linenBufferSets: (propertySection.data as Record<string, unknown>).linenBufferSets ?? 0,
      },
    });
  }

  if (propertySection?.data && (propertySection.data as Record<string, unknown>).inventoryEnabled) {
    items.push({
      entityType: "INVENTORY_DEFAULT",
      data: {
        items: (propertySection.data as Record<string, unknown>).defaultInventory,
      },
    });
  }

  // Create the package
  const pkg = await prisma.onboardingPackage.create({
    data: {
      surveyId,
      status: "SUBMITTED",
      summary: {
        clientData: clientSection?.data,
        propertyData: propertySection?.data,
        servicesData: servicesSection?.data,
        pricingData: pricingSection?.data,
        estimations: survey.estimations,
        checklists: survey.checklists,
        itemCount: items.length,
      },
      items: {
        create: items.map((item) => ({
          entityType: item.entityType,
          data: item.data,
          status: "PENDING" as const,
        })) as Parameters<typeof prisma.onboardingPackage.create>[0]["data"]["items"],
      },
    },
    include: { items: true },
  });

  // Update survey status
  await prisma.propertySurvey.update({
    where: { id: surveyId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  return apiSuccess(pkg);
}
