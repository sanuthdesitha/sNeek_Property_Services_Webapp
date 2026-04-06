import { NextResponse } from "next/server";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";
import { fetchGoogleReviews, getCachedGoogleReviews, saveCachedGoogleReviews } from "@/lib/public-site/google-reviews";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const cached = await getCachedGoogleReviews();
  if (cached) return NextResponse.json(cached);

  try {
    const [integrations, settings] = await Promise.all([getPhase3IntegrationsSettings(), getAppSettings()]);
    const placeId = integrations.googlePlaces.placeId || process.env.GOOGLE_PLACES_PLACE_ID?.trim() || "";
    if (placeId) {
      const payload = await fetchGoogleReviews(placeId);
      if (payload) {
        await saveCachedGoogleReviews(payload);
        return NextResponse.json(payload);
      }
    }

    const fallback = {
      rating: 4.9,
      user_ratings_total: settings.websiteContent.home.testimonials.length || 3,
      reviews: settings.websiteContent.home.testimonials.slice(0, 6).map((item) => ({
        author_name: item.author,
        rating: 5,
        text: item.quote,
        relative_time_description: item.meta || "Verified client",
      })),
      source: "fallback" as const,
      updatedAt: new Date().toISOString(),
    };
    return NextResponse.json(fallback);
  } catch (error: any) {
    return NextResponse.json({ rating: 4.9, user_ratings_total: 0, reviews: [], source: "fallback", updatedAt: new Date().toISOString(), error: error?.message ?? "Request failed." });
  }
}
