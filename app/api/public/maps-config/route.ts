import { NextResponse } from "next/server";

export async function GET() {
  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim() || "";

  return NextResponse.json(
    {
      enabled: Boolean(apiKey),
      apiKey,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}
