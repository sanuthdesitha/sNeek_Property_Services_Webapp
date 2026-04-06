import { NextRequest, NextResponse } from "next/server";
import { type MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { getPublicRequestedServiceLabel, normalizePublicServiceTypeForLead } from "@/lib/marketing/persistence";
import { sendWebsiteLeadNotification } from "@/lib/public-site/lead-notifications";
import { createPublicQuoteLead } from "@/lib/public-site/lead-persistence";
import { getAppSettings } from "@/lib/settings";
import { leadSchema } from "@/lib/validations/quote";
import { getValidationErrorMessage } from "@/lib/validations/errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
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
        },
    });

    try {
      await sendWebsiteLeadNotification({
        settings,
        subject: `New quote request: ${body.name} (${requestedServiceLabel})`,
        replyTo: body.email,
        html: `
          <h2>New quote request received</h2>
          <p><strong>Name:</strong> ${body.name}</p>
          <p><strong>Email:</strong> ${body.email}</p>
          <p><strong>Phone:</strong> ${body.phone || "Not provided"}</p>
          <p><strong>Suburb:</strong> ${body.suburb || "Not provided"}</p>
          <p><strong>Address:</strong> ${body.address || "Not provided"}</p>
          <p><strong>Requested service:</strong> ${requestedServiceLabel}</p>
          <p><strong>Estimate range:</strong> ${typeof body.estimateMin === "number" ? `$${body.estimateMin.toFixed(2)}` : "Pending manual review"}${typeof body.estimateMax === "number" ? ` to $${body.estimateMax.toFixed(2)}` : ""}</p>
          <p><strong>Notes:</strong></p>
          <p>${(body.notes || "No extra notes provided.").replace(/\n/g, "<br />")}</p>
          <p><strong>Lead ID:</strong> ${lead.id}</p>
        `,
      });
    } catch (error) {
      console.error("Website quote lead notification email failed", error);
    }

    return NextResponse.json(lead, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not submit quote request.") }, { status: 400 });
  }
}
