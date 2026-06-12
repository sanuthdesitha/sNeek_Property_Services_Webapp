import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { getPublicRequestedServiceLabel, normalizePublicServiceTypeForLead } from "@/lib/marketing/persistence";
import { sendWebsiteLeadNotification } from "@/lib/public-site/lead-notifications";
import { createPublicQuoteLead } from "@/lib/public-site/lead-persistence";
import { getAppSettings } from "@/lib/settings";
import { escapeHtml } from "@/lib/utils/escape-html";
import {
  optionalAddressSchema,
  optionalAustralianPhoneSchema,
  optionalSuburbSchema,
  requiredEmailSchema,
  requiredNameSchema,
} from "@/lib/validations/common";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { rateLimit, getClientIp } from "@/lib/security/rate-limit";

const contactSchema = z.object({
  inquiryType: z.enum(["general-clean", "deep-clean", "airbnb-turnover", "end-of-lease", "specialty-cleaning", "exterior-service", "commercial", "subscription", "custom-project"]),
  name: requiredNameSchema,
  email: requiredEmailSchema,
  phone: optionalAustralianPhoneSchema,
  suburb: optionalSuburbSchema,
  address: optionalAddressSchema,
  message: z.string().trim().min(10).max(4000),
});

const serviceTypeMap: Record<z.infer<typeof contactSchema>["inquiryType"], MarketedJobTypeValue> = {
  "general-clean": "GENERAL_CLEAN",
  "deep-clean": "DEEP_CLEAN",
  "airbnb-turnover": "AIRBNB_TURNOVER",
  "end-of-lease": "END_OF_LEASE",
  "specialty-cleaning": "CARPET_STEAM_CLEAN",
  "exterior-service": "PRESSURE_WASH",
  commercial: "COMMERCIAL_RECURRING",
  subscription: "GENERAL_CLEAN",
  "custom-project": "GENERAL_CLEAN",
};

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const { ok } = rateLimit(`contact:${ip}`, { limit: 5, windowMs: 10 * 60 * 1000 });
    if (!ok) {
      return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
    }

    const body = contactSchema.parse(await req.json());
    const settings = await getAppSettings();
    const requestedServiceType = serviceTypeMap[body.inquiryType];
    const requestedServiceLabel = getPublicRequestedServiceLabel(requestedServiceType);
    const notes = [`[Public contact request: ${body.inquiryType}]`, body.message].filter(Boolean).join("\n\n");

    const lead = await createPublicQuoteLead({
        serviceType: normalizePublicServiceTypeForLead(requestedServiceType),
        requestedServiceLabel,
        name: body.name,
        email: body.email,
        phone: body.phone,
        suburb: body.suburb,
        address: body.address,
        notes,
        structuredContext: {
          source: "website-contact",
          inquiryType: body.inquiryType,
          requestedServiceType,
          requestedServiceLabel,
        },
    });

    try {
      await sendWebsiteLeadNotification({
        settings,
        subject: `New website enquiry: ${body.name} (${body.inquiryType})`,
        replyTo: body.email,
        html: `
          <h2>New website enquiry received</h2>
          <p><strong>Name:</strong> ${escapeHtml(body.name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(body.email)}</p>
          <p><strong>Phone:</strong> ${escapeHtml(body.phone || "Not provided")}</p>
          <p><strong>Suburb:</strong> ${escapeHtml(body.suburb || "Not provided")}</p>
          <p><strong>Address:</strong> ${escapeHtml(body.address || "Not provided")}</p>
          <p><strong>Request type:</strong> ${escapeHtml(body.inquiryType)}</p>
          <p><strong>Requested service:</strong> ${escapeHtml(requestedServiceLabel)}</p>
          <p><strong>Message:</strong></p>
          <p>${escapeHtml(body.message).replace(/\n/g, "<br />")}</p>
          <p><strong>Lead ID:</strong> ${escapeHtml(lead.id)}</p>
        `,
      });
    } catch (error) {
      console.error("Website contact notification email failed", error);
    }

    return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not send your request.") }, { status: 400 });
  }
}
