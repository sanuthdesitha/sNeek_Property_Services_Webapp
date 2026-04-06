import { NextRequest, NextResponse } from "next/server";
import { checkSuburbAvailability } from "@/lib/public-site/availability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const suburb = new URL(req.url).searchParams.get("suburb") ?? "";
    return NextResponse.json(await checkSuburbAvailability(suburb));
  } catch (error: any) {
    return NextResponse.json(
      { available: true, message: "We service Greater Sydney", nextSlot: "Next weekday from 8am", error: error?.message ?? "Request failed." },
      { status: 200 }
    );
  }
}
