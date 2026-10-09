import { appIconResponse } from "@/lib/branding/app-icons";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return appIconResponse(32);
}
