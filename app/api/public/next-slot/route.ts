import { NextResponse } from "next/server";
import { findNextAvailableSlot } from "@/lib/public-site/availability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ nextSlot: await findNextAvailableSlot() });
  } catch (error: any) {
    return NextResponse.json({ nextSlot: "Next weekday from 8am", error: error?.message ?? "Request failed." });
  }
}
