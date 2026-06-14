import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const settings = await getAppSettings();
    return NextResponse.json({
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      evidenceStamp: settings.evidenceStamp,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        companyName: "sNeek Property Services",
        logoUrl: "",
        evidenceStamp: { dateFormat: "DD/MM/YYYY", timeFormat: "HH:mm", showWeekday: true },
        error: err?.message ?? "Failed to load branding.",
      },
      { status: 200 }
    );
  }
}
