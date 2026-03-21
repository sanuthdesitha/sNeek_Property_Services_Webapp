import { ImageResponse } from "next/og";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";
export const dynamic = "force-dynamic";

function initialsFromName(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "SP";
}

async function getLogoDataUrl(logoUrl: string) {
  if (!logoUrl) return null;

  try {
    const absoluteUrl = resolveAppUrl(logoUrl);
    const response = await fetch(absoluteUrl, { cache: "no-store" });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Icon() {
  const settings = await getAppSettings().catch(() => ({
    companyName: "sNeek Property Services",
    logoUrl: "",
  } as any));

  const companyName = settings.companyName || "sNeek Property Services";
  const logoUrl = settings.logoUrl?.trim() || "";
  const initials = initialsFromName(companyName);
  const logoDataUrl = await getLogoDataUrl(logoUrl);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f766e 0%, #155e75 100%)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt={companyName}
            width={64}
            height={64}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              color: "white",
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: 1,
            }}
          >
            {initials}
          </div>
        )}
      </div>
    ),
    {
      ...size,
    }
  );
}
