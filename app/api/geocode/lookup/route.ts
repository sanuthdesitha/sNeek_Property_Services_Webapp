import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { z } from "zod";

const schema = z.object({
  query: z.string().min(3).max(200),
});

interface PlacesTextSearchResult {
  places?: Array<{
    id: string;
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    addressComponents?: Array<{
      longText: string;
      shortText: string;
      types: string[];
    }>;
  }>;
}

const COMPONENT_LOOKUPS: Record<string, string> = {
  subpremise: "unit",
  street_number: "streetNumber",
  route: "route",
  locality: "suburb",
  postal_town: "suburb",
  sublocality_level_1: "suburb",
  administrative_area_level_1: "state",
  postal_code: "postcode",
  country: "country",
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Maps API not configured" }, { status: 500 });
  }

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.formattedAddress,places.location,places.addressComponents",
    },
    body: JSON.stringify({
      textQuery: parsed.data.query,
      regionCode: "AU",
      maxResultCount: 1,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json(
      { error: "Geocode failed", details: errText.slice(0, 200) },
      { status: 502 }
    );
  }

  const data: PlacesTextSearchResult = await res.json();
  const place = data.places?.[0];
  if (!place || !place.id || !place.location) {
    return NextResponse.json({ error: "No results" }, { status: 404 });
  }

  const result: any = {
    placeId: place.id,
    formattedAddress: place.formattedAddress ?? "",
    lat: place.location.latitude,
    lng: place.location.longitude,
    country: "AU",
  };
  for (const c of place.addressComponents ?? []) {
    for (const t of c.types) {
      const key = COMPONENT_LOOKUPS[t];
      if (key && !result[key]) {
        result[key] =
          t === "administrative_area_level_1" || t === "country" ? c.shortText : c.longText;
      }
    }
  }

  return NextResponse.json(result);
}
