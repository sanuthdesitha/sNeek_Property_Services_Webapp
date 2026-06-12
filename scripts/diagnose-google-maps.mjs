// Quick diagnostic: tests the Google Maps API key from .env against
// the 4 APIs we need. Run with: node scripts/diagnose-google-maps.mjs
// (or: npx tsx scripts/diagnose-google-maps.mjs)

// Read .env directly so this script has zero dependencies (dotenv may not be
// installed at the repo root).
import { readFileSync } from "node:fs";

function readEnvKey(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const m = text.match(new RegExp(`^${name}=(.*)$`, "m"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      /* file may not exist */
    }
  }
  return undefined;
}

const key = readEnvKey("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY") || readEnvKey("GOOGLE_MAPS_API_KEY");

console.log("\n=== Google Maps API Key Diagnostic ===\n");

if (!key) {
  console.error("❌ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not found in .env");
  console.error("   Fix: add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza... to .env (project root)");
  process.exit(1);
}

console.log(`✓  Key present in .env: ${key.slice(0, 8)}...${key.slice(-4)} (length ${key.length})`);
console.log("");

// Test 1: Geocoding API (REST, requires no special restrictions)
console.log("Test 1: Geocoding API");
try {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=1+George+Street+Sydney+NSW&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === "OK") {
    console.log(`   ✓  Geocoding works. Found: ${data.results[0].formatted_address}`);
  } else {
    console.log(`   ❌ Status: ${data.status}`);
    if (data.error_message) console.log(`      ${data.error_message}`);
  }
} catch (err) {
  console.log(`   ❌ Network error: ${err.message}`);
}
console.log("");

// Test 2: Places API (New) — Text Search
console.log("Test 2: Places API (New) — Text Search");
try {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.formattedAddress",
    },
    body: JSON.stringify({
      textQuery: "1 George Street Sydney",
      regionCode: "AU",
      maxResultCount: 1,
    }),
  });
  const data = await res.json();
  if (res.ok && data.places?.length) {
    console.log(`   ✓  Places API (New) works. Found: ${data.places[0].formattedAddress}`);
  } else {
    console.log(`   ❌ HTTP ${res.status}`);
    if (data.error?.message) console.log(`      ${data.error.message}`);
    else console.log(`      ${JSON.stringify(data).slice(0, 200)}`);
  }
} catch (err) {
  console.log(`   ❌ Network error: ${err.message}`);
}
console.log("");

// Test 3: Places API (Legacy — Autocomplete)
console.log("Test 3: Places API (legacy — Autocomplete, used by browser SDK)");
try {
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=1+george&components=country:au&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === "OK") {
    console.log(`   ✓  Places (legacy) Autocomplete works. First suggestion: ${data.predictions[0]?.description}`);
  } else {
    console.log(`   ❌ Status: ${data.status}`);
    if (data.error_message) console.log(`      ${data.error_message}`);
  }
} catch (err) {
  console.log(`   ❌ Network error: ${err.message}`);
}
console.log("");

// Test 4: Maps JavaScript API — we can't fetch the SDK headlessly, but we can
// check if the staticmap endpoint works (uses the same key + Maps JS API permission scope)
console.log("Test 4: Maps JavaScript API (via Static Maps probe)");
try {
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=Sydney&zoom=12&size=200x200&key=${key}`;
  const res = await fetch(url);
  if (res.ok) {
    console.log(`   ✓  Maps JavaScript API is enabled (Static Maps responded ${res.status})`);
  } else {
    const text = await res.text();
    console.log(`   ❌ HTTP ${res.status}`);
    console.log(`      ${text.slice(0, 200)}`);
  }
} catch (err) {
  console.log(`   ❌ Network error: ${err.message}`);
}
console.log("");

console.log("=== Summary ===");
console.log("");
console.log("If all 4 tests pass → the key is valid + APIs enabled + billing on.");
console.log("  The browser failure is almost certainly HTTP-referrer restriction.");
console.log("  Fix: Google Cloud Console → Credentials → your key →");
console.log("       Application restrictions → set to 'None' for dev,");
console.log("       OR add http://localhost:3000/* and http://localhost:*/* to allowed referrers.");
console.log("");
console.log("If a specific test fails:");
console.log("  • 'API_KEY_INVALID' / 'InvalidKeyMapError' → wrong key");
console.log("  • 'REQUEST_DENIED' + 'This API project is not authorized' → API not enabled in GCP");
console.log("  • 'REQUEST_DENIED' + 'This IP, site or mobile application is not authorized' → key restriction blocking server IP");
console.log("  • 'OVER_QUERY_LIMIT' → billing not enabled or quota exhausted");
console.log("  • 'gm_authFailure' (browser only) → referrer restriction or billing issue");
console.log("");
