import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const settings = await getAppSettings();
  return NextResponse.json({
    maintenanceEnabled: settings.websiteContent.maintenanceMode.enabled === true,
    allowLogin: settings.websiteContent.maintenanceMode.allowLogin !== false,
    message: settings.websiteContent.maintenanceMode.message,
    supportMessage: settings.websiteContent.maintenanceMode.supportMessage,
  });
}
