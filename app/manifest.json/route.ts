import { appIconUrl, getAppBrand } from "@/lib/branding/app-icons";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const brand = await getAppBrand().catch(() => ({
    name: "sNeek Property Services",
    logo: "",
    version: "default",
  }));
  return Response.json(
    {
      id: "/",
      name: brand.name,
      short_name: brand.name.slice(0, 24),
      description: "Property cleaning operations management",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#0284c7",
      orientation: "portrait",
      icons: [
        {
          src: appIconUrl(brand, 192),
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: appIconUrl(brand, 512),
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: appIconUrl(brand, 512, true),
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "no-store",
      },
    },
  );
}
