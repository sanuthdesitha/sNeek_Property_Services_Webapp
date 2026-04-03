import { NextResponse } from "next/server";
import { getPublishedSubscriptionPlans } from "@/lib/marketing/subscriptions";

export async function GET() {
  const plans = await getPublishedSubscriptionPlans();
  return NextResponse.json(plans);
}
