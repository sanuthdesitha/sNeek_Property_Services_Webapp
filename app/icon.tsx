import { appIconResponse } from "@/lib/branding/app-icons";
export const size = { width: 64, height: 64 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Icon() {
  return appIconResponse(64);
}
