/**
 * Shared Google Maps script loader.
 * Loads the Maps JS API once with the `places` library available.
 * Safe to call from multiple components — the same promise is reused.
 */

let _apiKey: string | null = null;
let _scriptPromise: Promise<void> | null = null;

async function resolveApiKey(): Promise<string> {
  if (_apiKey !== null) return _apiKey;

  const buildTimeKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (buildTimeKey) {
    _apiKey = buildTimeKey;
    return _apiKey;
  }

  try {
    const res = await fetch("/api/public/maps-config", { cache: "force-cache" });
    if (res.ok) {
      const body = await res.json();
      _apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    } else {
      _apiKey = "";
    }
  } catch {
    _apiKey = "";
  }
  return _apiKey as string;
}

function gw(): any {
  return typeof window !== "undefined" ? (window as any) : null;
}

/**
 * Ensures the Google Maps JS API (with the `places` library) is loaded.
 * Safe to call concurrently — only one <script> tag is ever injected.
 */
export async function ensureGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return;

  const w = gw();

  // Already fully loaded with places
  if (w.google?.maps?.places?.Autocomplete) return;

  // Maps core loaded (possibly without places) — try importLibrary
  if (w.google?.maps && typeof w.google.maps.importLibrary === "function") {
    if (!_scriptPromise) {
      _scriptPromise = Promise.resolve(w.google.maps.importLibrary("places")).then(() => undefined);
    }
    return _scriptPromise as Promise<void>;
  }

  // Maps core loaded without importLibrary (legacy load) — good enough for map rendering
  if (w.google?.maps?.Map) return;

  if (_scriptPromise) return _scriptPromise;

  _scriptPromise = new Promise<void>(async (resolve, reject) => {
    const apiKey = await resolveApiKey();
    if (!apiKey) {
      _scriptPromise = null;
      resolve();
      return;
    }

    const w2 = gw();

    // Check for any existing Maps script tag (old or new ID)
    const existing =
      (document.getElementById("gm-shared-script") as HTMLScriptElement | null) ||
      (document.getElementById("google-maps-places-script") as HTMLScriptElement | null);

    if (existing) {
      if (w2.google?.maps) { resolve(); return; }
      existing.addEventListener("load", () => { resolve(); }, { once: true });
      existing.addEventListener("error", () => reject(new Error("Maps script failed")), { once: true });
      return;
    }

    const callbackName = `__gmInit_${Math.random().toString(36).slice(2)}`;
    w2[callbackName] = () => {
      delete w2[callbackName];
      resolve();
    };

    const script = document.createElement("script");
    script.id = "gm-shared-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      _scriptPromise = null;
      reject(new Error("Failed to load Google Maps script"));
    };
    document.head.appendChild(script);
  });

  return _scriptPromise;
}
