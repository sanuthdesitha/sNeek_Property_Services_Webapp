import {
  appIconResponse,
  ICON_SIZES,
  type IconSize,
} from "@/lib/branding/app-icons";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: { size: string } },
) {
  const size = Number(params.size);
  if (!ICON_SIZES.includes(size as IconSize))
    return new Response("Unknown icon size", { status: 404 });
  return appIconResponse(
    size as IconSize,
    new URL(request.url).searchParams.get("maskable") === "1",
  );
}
