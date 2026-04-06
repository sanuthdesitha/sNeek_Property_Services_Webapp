import { db } from "@/lib/db";
import { canUseNodePrisma } from "@/lib/database-runtime";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";

const CACHE_KEY = "google_reviews_cache";
const TTL_MS = 24 * 60 * 60 * 1000;

export type GoogleReviewRow = {
  author_name: string;
  profile_photo_url?: string;
  rating: number;
  relative_time_description?: string;
  text: string;
  time?: number;
};

export type GoogleReviewsPayload = {
  rating: number | null;
  user_ratings_total: number | null;
  reviews: GoogleReviewRow[];
  source: "google" | "fallback";
  updatedAt: string;
};

function sanitizeReview(value: unknown): GoogleReviewRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const author_name = typeof row.author_name === "string" ? row.author_name.trim().slice(0, 160) : "";
  const text = typeof row.text === "string" ? row.text.trim().slice(0, 4000) : "";
  const rating = Number(row.rating ?? 0);
  if (!author_name || !text || !Number.isFinite(rating)) return null;
  return {
    author_name,
    profile_photo_url: typeof row.profile_photo_url === "string" ? row.profile_photo_url.trim().slice(0, 2000) : undefined,
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    relative_time_description:
      typeof row.relative_time_description === "string"
        ? row.relative_time_description.trim().slice(0, 120)
        : undefined,
    text,
    time: Number.isFinite(Number(row.time)) ? Number(row.time) : undefined,
  };
}

function sanitizePayload(value: unknown): GoogleReviewsPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const reviews = Array.isArray(row.reviews)
    ? row.reviews.map(sanitizeReview).filter((item): item is GoogleReviewRow => Boolean(item)).slice(0, 6)
    : [];
  const rating = row.rating == null ? null : Number(row.rating);
  const user_ratings_total = row.user_ratings_total == null ? null : Number(row.user_ratings_total);
  return {
    rating: Number.isFinite(Number(rating)) ? Number(rating) : null,
    user_ratings_total: Number.isFinite(Number(user_ratings_total)) ? Number(user_ratings_total) : null,
    reviews,
    source: row.source === "google" ? "google" : "fallback",
    updatedAt: typeof row.updatedAt === "string" && row.updatedAt ? row.updatedAt : new Date(0).toISOString(),
  };
}

export async function getCachedGoogleReviews() {
  if (!canUseNodePrisma()) return null;
  try {
    const row = await db.appSetting.findUnique({ where: { key: CACHE_KEY } });
    if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) return null;
    const payload = sanitizePayload(row.value);
    if (!payload) return null;
    const updatedAtMs = new Date(payload.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function saveCachedGoogleReviews(payload: GoogleReviewsPayload) {
  if (!canUseNodePrisma()) return;
  await db.appSetting.upsert({
    where: { key: CACHE_KEY },
    create: { key: CACHE_KEY, value: payload as any },
    update: { value: payload as any },
  });
}

export async function fetchGoogleReviews(placeId: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey || !placeId.trim()) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId.trim());
  url.searchParams.set("fields", "rating,user_ratings_total,reviews");
  url.searchParams.set("reviews_sort", "newest");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Google Places returned ${response.status}`);
  }
  const body = (await response.json()) as {
    result?: {
      rating?: number;
      user_ratings_total?: number;
      reviews?: GoogleReviewRow[];
    };
  };
  return sanitizePayload({
    rating: body.result?.rating ?? null,
    user_ratings_total: body.result?.user_ratings_total ?? null,
    reviews: body.result?.reviews ?? [],
    source: "google",
    updatedAt: new Date().toISOString(),
  });
}

export async function refreshGoogleReviewsCache() {
  const settings = await getPhase3IntegrationsSettings();
  const placeId = settings.googlePlaces.placeId?.trim() || "";
  if (!placeId) return null;
  const payload = await fetchGoogleReviews(placeId);
  if (!payload) return null;
  await saveCachedGoogleReviews(payload);
  return payload;
}
