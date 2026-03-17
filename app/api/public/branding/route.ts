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
    });
  } catch (err: any) {
    return NextResponse.json(
      { companyName: "sNeek Property Services", logoUrl: "", error: err?.message ?? "Failed to load branding." },
      { status: 200 }
    );
  }
}
