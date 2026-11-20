// @vitest-environment node
/**
 * Property devices providers (2026-11-20), against recorded-shape fixtures
 * (ring-client-api / Minut v8 shapes; never the real services):
 * - every request is on the read-only allow-list, and nothing else is ever requested;
 * - Ring hands over the rotated refresh token before anything uses the new access token;
 * - Ring 2FA (412) answers needs_code with Ring's own prompt;
 * - tokens and passwords never appear in error messages;
 * - parsing keeps unknown battery as null and offline readings unrecorded;
 * - Minut sends the client id and secret as HTTP Basic.
 */
import { describe, expect, it } from "vitest";
import { ALL_ALLOWED, assertAllowed, MINUT_ALLOWED, ProviderHttpError, RING_ALLOWED, type ProviderFetchDeps } from "@/lib/property-devices/providers/http";
import { parseRingDevices, parseRingLocations, ringReadSnapshot, ringSignIn } from "@/lib/property-devices/providers/ring-client";
import { minutCheck, minutReadSnapshot, parseMinutDevices } from "@/lib/property-devices/providers/minut-client";

type Call = { method: string; url: string; headers: Record<string, string>; body?: string };

const RING_DEVICES = {
  doorbots: [{ id: 101, description: "Front door", location_id: "loc-1", battery_life: "18", alerts: { connection: "online" }, health: { battery_percentage: 18 } }],
  authorized_doorbots: [],
  stickup_cams: [
    { id: 202, description: "Back yard", location_id: "loc-1", battery_life: null, alerts: { connection: "offline" }, health: { battery_percentage: 64 } },
    { id: 303, description: "Garage (wired)", location_id: "loc-2", battery_life: null, alerts: { connection: "online" }, health: {} },
  ],
  chimes: [{ id: 404, description: "Chime", location_id: "loc-1" }],
  base_stations: [],
  beams_bridges: [],
  other: [],
};
const RING_LOCATIONS = { user_locations: [{ location_id: "loc-1", name: "Bondi Beach House", address: { address1: "1 Ocean St", city: "Bondi", state: "NSW", zip_code: "2026" } }] };

function fakeDeps(respond: (call: Call) => { status: number; body?: unknown }): { deps: ProviderFetchDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: ProviderFetchDeps = {
    timeoutMs: 1000,
    sleep: async () => undefined,
    checkUrl: async () => undefined,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = { method: String(init?.method ?? "GET"), url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined };
      calls.push(call);
      const answer = respond(call);
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  };
  return { deps, calls };
}

function expectOnlyAllowed(calls: Call[]) {
  for (const call of calls) {
    expect(ALL_ALLOWED.some((entry) => entry.method === call.method && entry.url === call.url)).toBe(true);
  }
}

describe("allow-list", () => {
  it("lists only read-only Ring and Minut endpoints: no video, snapshot, live view, history or settings", () => {
    const paths = ALL_ALLOWED.map((entry) => entry.url);
    for (const forbidden of ["snapshot", "recording", "live", "history", "dings", "motion", "settings", "siren", "light", "chime_settings"]) {
      expect(paths.some((path) => path.toLowerCase().includes(forbidden))).toBe(false);
    }
    expect(RING_ALLOWED.map((entry) => new URL(entry.url).host).every((host) => host === "oauth.ring.com" || host === "api.ring.com")).toBe(true);
    expect(MINUT_ALLOWED.every((entry) => new URL(entry.url).host === "api.minut.com")).toBe(true);
    // Only GET reads, plus the token and session POSTs.
    expect(ALL_ALLOWED.filter((entry) => entry.method === "POST").map((entry) => new URL(entry.url).pathname)).toEqual(["/oauth/token", "/clients_api/session", "/v8/oauth/token"]);
  });

  it("refuses anything not on the list before a request is made", () => {
    expect(() => assertAllowed("GET", "https://api.ring.com/clients_api/snapshots/image/101")).toThrow(ProviderHttpError);
    expect(() => assertAllowed("PUT", "https://api.ring.com/clients_api/doorbots/101")).toThrow(/read-only list/);
    expect(() => assertAllowed("GET", "https://api.ring.com/clients_api/ring_devices?x=1")).toThrow();
  });
});

describe("Ring", () => {
  it("a full read requests only allow-listed paths and stores the rotated token before using the access token", async () => {
    const order: string[] = [];
    const { deps, calls } = fakeDeps((call) => {
      order.push(`${call.method} ${new URL(call.url).pathname}`);
      if (call.url.endsWith("/oauth/token")) return { status: 200, body: { access_token: "ACCESS-SECRET-1", refresh_token: "REFRESH-NEW-2", expires_in: 3600 } };
      if (call.url.endsWith("/session")) return { status: 201, body: {} };
      if (call.url.endsWith("/locations")) return { status: 200, body: RING_LOCATIONS };
      return { status: 200, body: RING_DEVICES };
    });
    const persisted: string[] = [];
    const snapshot = await ringReadSnapshot(deps, {
      refreshToken: "REFRESH-OLD-1",
      hardwareId: "hw-1",
      persistRotated: async (token) => {
        persisted.push(token);
        order.push("persist");
      },
      now: () => new Date("2026-11-20T10:00:00Z"),
    });
    expectOnlyAllowed(calls);
    expect(persisted).toEqual(["REFRESH-NEW-2"]);
    expect(order.indexOf("persist")).toBe(1);
    expect(order[0]).toBe("POST /oauth/token");
    expect(JSON.parse(calls[0].body!)).toMatchObject({ grant_type: "refresh_token", refresh_token: "REFRESH-OLD-1", client_id: "ring_official_android" });
    expect(calls.slice(1).every((call) => call.headers.Authorization === "Bearer ACCESS-SECRET-1")).toBe(true);
    expect(snapshot.locations).toEqual([{ externalLocationId: "loc-1", name: "Bondi Beach House", address: "1 Ocean St, Bondi, NSW, 2026" }]);
    expect(snapshot.devices.map((device) => device.externalDeviceId)).toEqual(["101", "202", "303"]);
  });

  it("parses battery honestly: offline keeps no reading, no battery is unknown and wired", () => {
    const seen = new Date("2026-11-20T10:00:00Z");
    const [front, back, garage] = parseRingDevices(RING_DEVICES, seen);
    expect(front).toMatchObject({ kind: "DOORBELL", batteryPercent: 18, batteryPowered: true, online: true, readAt: seen });
    expect(back).toMatchObject({ kind: "CAMERA", batteryPercent: 64, online: false, readAt: null });
    expect(garage).toMatchObject({ batteryPercent: null, batteryPowered: false, readAt: null });
    expect(parseRingLocations(RING_LOCATIONS)).toHaveLength(1);
    expect(() => parseRingDevices({ unexpected: true }, seen)).toThrow(/expected format/);
  });

  it("sign-in without a code asks for Ring's code; the password never appears in an error", async () => {
    const { deps, calls } = fakeDeps(() => ({ status: 412, body: { tsv_state: "sms", phone: "+61xxxxxx89" } }));
    const result = await ringSignIn(deps, { email: "shared@example.test", password: "PASSWORD-SECRET", hardwareId: "hw" });
    expect(result).toEqual({ kind: "needs_code", prompt: "Enter the code Ring sent by sms to +61xxxxxx89." });
    expect(calls[0].headers["2fa-support"]).toBe("true");
    expectOnlyAllowed(calls);

    const refused = fakeDeps(() => ({ status: 401, body: { error: "invalid user credentials PASSWORD-SECRET" } }));
    const error = await ringSignIn(refused.deps, { email: "shared@example.test", password: "PASSWORD-SECRET", hardwareId: "hw" }).catch((err: unknown) => err as Error);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as Error).message).not.toContain("PASSWORD-SECRET");

    const wrongCode = fakeDeps(() => ({ status: 400, body: { error: "Verification Code is invalid or expired" } }));
    await expect(ringSignIn(wrongCode.deps, { email: "s@e.test", password: "p", twoFactorCode: "123456", hardwareId: "hw" })).rejects.toMatchObject({ kind: "two_factor" });
  });

  it("a connected sign-in returns the refresh token and nothing else is requested", async () => {
    const { deps, calls } = fakeDeps(() => ({ status: 200, body: { access_token: "A", refresh_token: "R-1" } }));
    await expect(ringSignIn(deps, { email: "s@e.test", password: "p", twoFactorCode: "123456", hardwareId: "hw" })).resolves.toEqual({ kind: "connected", refreshToken: "R-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["2fa-code"]).toBe("123456");
  });

  it("a refused renewal is an auth failure in words, without the token", async () => {
    const { deps } = fakeDeps(() => ({ status: 401, body: { error: "invalid_grant REFRESH-OLD-1" } }));
    const error = await ringReadSnapshot(deps, { refreshToken: "REFRESH-OLD-1", hardwareId: "hw", persistRotated: async () => undefined, now: () => new Date() }).catch((err: unknown) => err as ProviderHttpError);
    expect(error.kind).toBe("auth");
    expect(error.message).not.toContain("REFRESH-OLD-1");
  });

  it("retries a 503 with backoff, then reports it as a passing problem", async () => {
    const { deps, calls } = fakeDeps(() => ({ status: 503 }));
    await expect(ringReadSnapshot(deps, { refreshToken: "r", hardwareId: "hw", persistRotated: async () => undefined, now: () => new Date() })).rejects.toMatchObject({ kind: "transient" });
    expect(calls).toHaveLength(3);
  });
});

describe("Minut", () => {
  it("uses HTTP Basic client credentials and reads homes and devices only", async () => {
    const { deps, calls } = fakeDeps((call) => {
      if (call.url.endsWith("/oauth/token")) return { status: 200, body: { access_token: "MINUT-ACCESS", token_type: "Bearer", expires_in: 3600 } };
      if (call.url.endsWith("/homes")) return { status: 200, body: { homes: [{ home_id: "home-1", name: "Coogee Flat", location: { street_name1: "3 Beach Rd", city: "Coogee" } }] } };
      if (call.url.endsWith("/users/me")) return { status: 200, body: { user_id: "u", email: "ops@example.test" } };
      return { status: 200, body: { devices: [
        { device_id: "dev-1", description: "Living room", home: "home-1", battery: { percent: 22 }, offline: false, last_heard_from_at: "2026-11-20T09:00:00Z" },
        { device_id: "dev-2", description: "Bedroom", home: "home-1", battery: {}, offline: true, last_heard_from_at: "2026-11-18T09:00:00Z" },
      ] } };
    });
    const snapshot = await minutReadSnapshot(deps, { clientId: "CID", clientSecret: "CSECRET" });
    expectOnlyAllowed(calls);
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from("CID:CSECRET").toString("base64")}`);
    expect(calls[0].body).toContain("grant_type=client_credentials");
    expect(snapshot.locations[0]).toMatchObject({ externalLocationId: "home-1", name: "Coogee Flat" });
    expect(snapshot.devices[0]).toMatchObject({ kind: "NOISE_SENSOR", batteryPercent: 22, online: true, readAt: new Date("2026-11-20T09:00:00Z") });
    expect(snapshot.devices[1]).toMatchObject({ batteryPercent: null, online: false, readAt: null });
    await expect(minutCheck(deps, { clientId: "CID", clientSecret: "CSECRET" })).resolves.toBe("ops@example.test");
  });

  it("refused credentials say what to check, without the secret", async () => {
    const { deps } = fakeDeps(() => ({ status: 401, body: { error: "bad client CSECRET" } }));
    const error = await minutReadSnapshot(deps, { clientId: "CID", clientSecret: "CSECRET" }).catch((err: unknown) => err as ProviderHttpError);
    expect(error.kind).toBe("auth");
    expect(error.message).toMatch(/client id or secret/);
    expect(error.message).not.toContain("CSECRET");
  });

  it("a device without a report time records no reading", () => {
    expect(parseMinutDevices({ devices: [{ device_id: "d", battery: { percent: 50 } }] })[0]).toMatchObject({ batteryPercent: 50, readAt: null });
  });
});
