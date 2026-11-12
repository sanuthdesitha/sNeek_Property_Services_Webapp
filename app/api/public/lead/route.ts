import { NextRequest, NextResponse } from "next/server";
import { type MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { getPublicRequestedServiceLabel, normalizePublicServiceTypeForLead } from "@/lib/marketing/persistence";
import { sendWebsiteLeadNotification } from "@/lib/public-site/lead-notifications";
import { createPublicQuoteLead } from "@/lib/public-site/lead-persistence";
import { getAppSettings } from "@/lib/settings";
import { escapeHtml } from "@/lib/utils/escape-html";
import { leadSchema } from "@/lib/validations/quote";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { rateLimit, getClientIp } from "@/lib/security/rate-limit";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const { ok } = rateLimit(`lead:${ip}`, { limit: 8, windowMs: 10 * 60 * 1000 });
    if (!ok) {
      return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
    }

    const body = leadSchema.parse(await req.json());
    const settings = await getAppSettings();
    const requestedServiceType = body.serviceType as MarketedJobTypeValue;
    const requestedServiceLabel = body.requestedServiceLabel || getPublicRequestedServiceLabel(requestedServiceType);

    const lead = await createPublicQuoteLead({
        serviceType: normalizePublicServiceTypeForLead(requestedServiceType),
        requestedServiceLabel,
        name: body.name,
        email: body.email,
        phone: body.phone,
        address: body.address,
        suburb: body.suburb,
        bedrooms: body.bedrooms,
        bathrooms: body.bathrooms,
        hasBalcony: body.hasBalcony,
        notes: body.notes,
        estimateMin: body.estimateMin,
        estimateMax: body.estimateMax,
        promoCode: body.promoCode,
        structuredContext: {
          ...(body.structuredContext ?? {}),
          requestedServiceType,
          requestedServiceLabel,
          source: body.structuredContext?.source ?? "website-quote",
          // Address geo (Plan D) — stored in JSON until QuoteLead schema gains columns
          ...(body.state ? { addressState: body.state } : {}),
          ...(body.postcode ? { addressPostcode: body.postcode } : {}),
          ...(typeof body.latitude === "number" ? { addressLat: body.latitude } : {}),
          ...(typeof body.longitude === "number" ? { addressLng: body.longitude } : {}),
          ...(body.placeId ? { addressPlaceId: body.placeId } : {}),
        },
    });

    try {
      const wording = await loadNotificationWording("leads.alerts");
      const notProvided = wording.line("not-provided", "INBOX", {});
      const leadEmail = wording.render("website-quote", "EMAIL", {
        name: body.name,
        email: body.email,
        phone: body.phone || notProvided,
        suburb: body.suburb || notProvided,
        address: body.address || notProvided,
        service: requestedServiceLabel,
        estimate: `${typeof body.estimateMin === "number" ? `$${body.estimateMin.toFixed(2)}` : wording.line("pending-review", "INBOX", {})}${wording.line("estimate-to", "INBOX", { amount: typeof body.estimateMax === "number" ? `$${body.estimateMax.toFixed(2)}` : "" }, typeof body.estimateMax === "number")}`,
        notesHtml: escapeHtml(body.notes || wording.line("no-notes", "INBOX", {})).replace(/\n/g, "<br />"),
        leadId: lead.id,
      });
      await sendWebsiteLeadNotification({
        settings,
        subject: leadEmail.subject,
        replyTo: body.email,
        html: leadEmail.html,
      });
    } catch (error) {
      console.error("Website quote lead notification email failed", error);
    }

    return NextResponse.json(lead, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not submit quote request.") }, { status: 400 });
  }
}
