import { NextRequest, NextResponse } from "next/server";
import { validateDiscountCampaign } from "@/lib/marketing/campaigns";
import { isMarketedJobType } from "@/lib/marketing/job-types";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim() ?? "";
  const serviceType = req.nextUrl.searchParams.get("serviceType");
  const subtotalRaw = req.nextUrl.searchParams.get("subtotal");
  const subtotal = subtotalRaw ? Number(subtotalRaw) : undefined;

  if (!code) {
    return NextResponse.json({ valid: false, reason: "Campaign code is required." }, { status: 400 });
  }

  const normalizedServiceType = serviceType && isMarketedJobType(serviceType) ? serviceType : undefined;
  const result = await validateDiscountCampaign(code, normalizedServiceType, Number.isFinite(subtotal) ? subtotal : undefined);
  return NextResponse.json(result, { status: result.valid ? 200 : 404 });
}
