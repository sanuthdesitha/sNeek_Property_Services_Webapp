import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Plan D backfill: geocode existing Property and Client addresses where
 * latitude is null. Logs failures to GeocodeFailure for later review.
 *
 * Usage:
 *   npx tsx scripts/backfill/geocode-addresses.ts
 *
 * NOTE: User backfill is intentionally skipped because the User model does
 * not have a top-level `address` column today — staff addresses live in
 * extendedProfile JSON, and we don't want to mass-geocode against an
 * unstructured payload. Wire that up in a follow-up once the profile shape
 * is finalised.
 */

const API_URL = "https://places.googleapis.com/v1/places:searchText";
const RATE_PER_SECOND = 10; // conservative — well under any per-second quota
const SLEEP_MS = Math.ceil(1000 / RATE_PER_SECOND);

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface GeoResult {
  lat: number;
  lng: number;
  placeId: string;
  formattedAddress: string;
}

async function geocode(query: string): Promise<GeoResult | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.formattedAddress,places.location",
    },
    body: JSON.stringify({ textQuery: query, regionCode: "AU", maxResultCount: 1 }),
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  const place = data.places?.[0];
  if (!place?.id || !place?.location) return null;
  return {
    placeId: place.id,
    formattedAddress: place.formattedAddress ?? query,
    lat: place.location.latitude,
    lng: place.location.longitude,
  };
}

async function backfillModel(
  modelName: "Property" | "Client",
  fetcher: () => Promise<Array<{ id: string; address: string | null }>>,
  updater: (id: string, data: { latitude: number; longitude: number; placeId: string }) => Promise<void>
) {
  const rows = await fetcher();
  console.log(`[${modelName}] ${rows.length} rows to geocode`);
  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    if (!row.address) {
      fail++;
      await (db as any).geocodeFailure.create({
        data: { modelType: modelName, modelId: row.id, query: "", reason: "Empty address" },
      });
      continue;
    }
    try {
      const result = await geocode(row.address);
      if (!result) {
        fail++;
        await (db as any).geocodeFailure.create({
          data: { modelType: modelName, modelId: row.id, query: row.address, reason: "No result" },
        });
      } else {
        await updater(row.id, {
          latitude: result.lat,
          longitude: result.lng,
          placeId: result.placeId,
        });
        ok++;
      }
    } catch (err) {
      fail++;
      await (db as any).geocodeFailure.create({
        data: {
          modelType: modelName,
          modelId: row.id,
          query: row.address,
          reason: err instanceof Error ? err.message : "Unknown",
        },
      });
    }
    await sleep(SLEEP_MS);
  }
  console.log(`[${modelName}] done — ${ok} ok, ${fail} failed`);
}

async function main() {
  await backfillModel(
    "Property",
    () => db.property.findMany({ where: { latitude: null }, select: { id: true, address: true } }),
    (id, data) => db.property.update({ where: { id }, data }).then(() => undefined)
  );
  await backfillModel(
    "Client",
    () =>
      db.client.findMany({ where: { latitude: null }, select: { id: true, address: true } }) as Promise<
        Array<{ id: string; address: string | null }>
      >,
    (id, data) => db.client.update({ where: { id }, data }).then(() => undefined)
  );
  await db.$disconnect();
}

main()
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
