import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { publicUrl } from "@/lib/s3";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/svg+xml";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function initialsFromName(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "SP";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function getLogoDataUrl(logoUrl: string) {
  if (!logoUrl) return null;

  try {
    const isAbsolute = /^https?:\/\//i.test(logoUrl);
    const fallbackBase =
      process.env.APP_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      "http://localhost:3000";
    const candidates = Array.from(
      new Set(
        isAbsolute
          ? [logoUrl]
          : logoUrl.startsWith("/")
            ? [new URL(logoUrl, fallbackBase).toString(), resolveAppUrl(logoUrl)]
            : [resolveAppUrl(logoUrl), publicUrl(logoUrl)]
      )
    );

    for (const absoluteUrl of candidates) {
      try {
        const response = await fetch(absoluteUrl, { cache: "no-store" });
        if (!response.ok) continue;
        const contentType = response.headers.get("content-type") || "image/png";
        const buffer = Buffer.from(await response.arrayBuffer());
        return `data:${contentType};base64,${buffer.toString("base64")}`;
      } catch {
        // Try the next candidate.
      }
    }

    return null;
  } catch {
    return null;
  }
}

export default async function Icon() {
  const settings = await getAppSettings().catch(() => ({
    companyName: "sNeek Property Services",
    logoUrl: "",
  }));

  const companyName = settings.companyName || "sNeek Property Services";
  const logoUrl = settings.logoUrl?.trim() || "";
  const initials = escapeXml(initialsFromName(companyName));
  const logoDataUrl = await getLogoDataUrl(logoUrl);

  const svg = logoDataUrl
    ? `
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="16" ry="16" fill="#ffffff" />
        <rect x="5" y="5" width="54" height="54" rx="13" ry="13" fill="#ffffff" stroke="#d7e0ea" />
        <circle cx="32" cy="32" r="21" fill="#ffffff" stroke="#d7e0ea" />
        <image href="${logoDataUrl}" x="18" y="18" width="28" height="28" preserveAspectRatio="xMidYMid meet" />
      </svg>
    `
    : `
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="icon-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0f766e" />
            <stop offset="100%" stop-color="#155e75" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" ry="16" fill="url(#icon-gradient)" />
        <text
          x="32"
          y="38"
          text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif"
          font-size="24"
          font-weight="700"
          letter-spacing="1"
          fill="#ffffff"
        >
          ${initials}
        </text>
      </svg>
    `;

  return new Response(svg.trim(), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
