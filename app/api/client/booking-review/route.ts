import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { calculateQuote } from "@/lib/pricing/calculator";
import { DEFAULT_SETTINGS, getAppSettings } from "@/lib/settings";
import { hasVaPermission } from "@/lib/va/permissions";

export const dynamic = "force-dynamic";

// Keep aligned with BOOKABLE_SERVICES in the client booking flow.
const querySchema = z.object({
  propertyId: z.string().max(128).trim().min(1).regex(/^[A-Za-z0-9_-]+$/),
  serviceType: z.enum(["GENERAL_CLEAN", "DEEP_CLEAN", "END_OF_LEASE", "AIRBNB_TURNOVER", "SPRING_CLEANING"]),
});

type Pricing = { state: "estimate" | "hidden" | "unavailable"; total?: number; gst?: number };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

function textRecorded(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function hasImages(value: unknown): boolean {
  return Array.isArray(value) && value.some(image => textRecorded(record(image).url));
}

function accessRecorded(property: {
  accessCode: unknown; keyLocation: unknown; accessNotes: unknown; accessGuide: unknown; accessInfo: unknown;
}): boolean {
  if ([property.accessCode, property.keyLocation, property.accessNotes].some(textRecorded)) return true;
  // Ignore guide identifiers/labels and unrelated operational accessInfo metadata.
  if (Array.isArray(property.accessGuide) && property.accessGuide.some(value => {
    const entry = record(value);
    return [entry.instructions, entry.locationNote, entry.level].some(textRecorded) || hasImages(entry.images);
  })) return true;
  const info = record(property.accessInfo);
  return ["lockbox", "codes", "keyLocation", "parking", "other", "instructions"]
    .some(key => textRecorded(info[key])) || hasImages(info.attachments);
}

function time(value: unknown): string | null {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function validAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function GET(req: Request) {
  try {
    const settings = await getAppSettings();
    // A missing settings row legitimately uses defaults; a failed read must not enable modules.
    if (settings === DEFAULT_SETTINGS) {
      const row = await db.appSetting.findUnique({ where: { key: "app" }, select: { key: true } });
      if (row) return json({ error: "Booking review unavailable." }, 503);
    }
    const portal = await requireClientPortal({ permission: "bookings", settings });
    if (!isClientModuleEnabled(portal.visibility, "booking")) {
      return json({ error: "Booking is disabled for this client." }, 403);
    }

    const params = new URL(req.url).searchParams;
    const parsed = querySchema.safeParse({ propertyId: params.get("propertyId"), serviceType: params.get("serviceType") });
    if (!parsed.success || params.getAll("propertyId").length !== 1 || params.getAll("serviceType").length !== 1) {
      return json({ error: "Invalid booking review request." }, 400);
    }
    const { propertyId, serviceType } = parsed.data;
    const property = await db.property.findFirst({
      where: {
        id: propertyId, clientId: portal.clientId, isActive: true,
        ...(portal.propertyIds ? { AND: [{ id: { in: portal.propertyIds } }] } : {}),
      },
      select: {
        bedrooms: true, bathrooms: true,
        defaultCheckinTime: true, defaultCheckoutTime: true, jobTimeSource: true,
        accessCode: true, keyLocation: true, accessNotes: true, accessGuide: true, accessInfo: true,
      },
    });
    if (!property) return json({ error: "Property not found." }, 404);

    let pricing: Pricing = { state: "hidden" };
    if (isClientModuleEnabled(portal.visibility, "finance") && hasVaPermission(portal.permissions, "invoicesView")) {
      pricing = { state: "unavailable" };
      try {
        const quote = await calculateQuote({ serviceType, bedrooms: property.bedrooms, bathrooms: property.bathrooms });
        if (quote && validAmount(quote.total) && validAmount(quote.gst)) {
          pricing = { state: "estimate", total: quote.total, gst: quote.gst };
        }
      } catch {
        // An estimate failure does not prevent reviewing timing and access readiness.
      }
    }

    return json({
      propertyId, serviceType, pricing,
      timing: {
        checkin: time(property.defaultCheckinTime), checkout: time(property.defaultCheckoutTime),
        source: property.jobTimeSource === "PROPERTY" || property.jobTimeSource === "ICAL" ? property.jobTimeSource : null,
      },
      access: { recorded: accessRecorded(property) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return json({ error: "Unauthorized." }, 401);
    if (message === "FORBIDDEN") return json({ error: "Forbidden." }, 403);
    if (message === "CLIENT_PROFILE_MISSING") return json({ error: "Account not found." }, 404);
    return json({ error: "Booking review unavailable." }, 503);
  }
}
