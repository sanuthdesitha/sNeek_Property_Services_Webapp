import { NextResponse } from "next/server";
import { getPublishedSubscriptionPlans } from "@/lib/marketing/subscriptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const plans = await getPublishedSubscriptionPlans();
  return NextResponse.json(plans);
}
