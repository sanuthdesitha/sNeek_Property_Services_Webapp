import "server-only";
/**
 * Ring: custom, read-only connector (2026-11-20).
 *
 * Ring does not offer an official connection. This uses Ring's app interface
 * as documented by the open-source ring-client-api project
 * (github.com/dgreif/ring, packages/ring-client-api: rest-client.ts for the
 * OAuth and session shapes, api.ts for `clients_api/ring_devices` and
 * `devices/v1/locations`, ring-types.ts for `battery_life`,
 * `health.battery_percentage` and `alerts.connection`; read 2026-11-20).
 * It was built against those documented shapes and recorded-shape fixtures.
 * It has NOT been run against the real Ring service from this environment.
 *
 * Conditions (owner agreement): a separate Ring account added as a shared user
 * on each location; only the refresh token (encrypted) and a generated
 * hardware id are kept, never the password; device list and battery/health
 * only (the allow-list in ./http.ts enforces this); fail loudly.
 */
import { randomUUID } from "node:crypto";
import { isPercent } from "../charge-policy";
import { ProviderHttpError, providerFetch, readJson, type ProviderFetchDeps } from "./http";
import type { ProviderDevice, ProviderLocation, ProviderSnapshot } from "./types";

const TOKEN_URL = "https://oauth.ring.com/oauth/token";
const SESSION_URL = "https://api.ring.com/clients_api/session";
const DEVICES_URL = "https://api.ring.com/clients_api/ring_devices";
const LOCATIONS_URL = "https://api.ring.com/devices/v1/locations";
const USER_AGENT = "android:com.ringapp";

export function newRingHardwareId(): string {
  return randomUUID();
}

type TokenGrant = { accessToken: string; refreshToken: string };

export type RingSignInResult =
  | { kind: "needs_code"; prompt: string }
  | { kind: "connected"; refreshToken: string };

function tokenHeaders(hardwareId: string, twoFactorCode: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    // Ring answers 406 to the sign-in without this (ring-client-api sends it on every JSON request).
    Accept: "application/json",
    "2fa-support": "true",
    "2fa-code": twoFactorCode,
    hardware_id: hardwareId,
    "User-Agent": USER_AGENT,
  };
}

function readGrant(body: unknown): TokenGrant {
  const record = (body ?? {}) as Record<string, unknown>;
  const accessToken = typeof record.access_token === "string" ? record.access_token : "";
  const refreshToken = typeof record.refresh_token === "string" ? record.refresh_token : "";
  if (!accessToken || !refreshToken) throw new ProviderHttpError("Ring answered without a sign-in token. Ring may have changed its interface.", null, "refused");
  return { accessToken, refreshToken };
}

function twoFactorPrompt(body: unknown): string {
  const record = (body ?? {}) as Record<string, unknown>;
  const state = typeof record.tsv_state === "string" ? record.tsv_state : "";
  if (state === "totp") return "Enter the code from the shared account's authenticator app.";
  if (state) return `Enter the code Ring sent by ${state}${typeof record.phone === "string" ? ` to ${record.phone}` : ""}.`;
  return "Enter the code Ring sent to the shared account's phone or email.";
}

/**
 * Sign in with the shared account. Without a code, Ring answers 412 and sends
 * one; call again with the code. The password is used for this request only.
 */
export async function ringSignIn(deps: ProviderFetchDeps, input: { email: string; password: string; twoFactorCode?: string; hardwareId: string }): Promise<RingSignInResult> {
  const response = await providerFetch(deps, "POST", TOKEN_URL, {
    headers: tokenHeaders(input.hardwareId, input.twoFactorCode?.trim() ?? ""),
    body: JSON.stringify({ client_id: "ring_official_android", scope: "client", grant_type: "password", username: input.email, password: input.password }),
  });
  if (response.status === 412) return { kind: "needs_code", prompt: twoFactorPrompt(await response.json().catch(() => null)) };
  if (response.status === 400 || response.status === 401) {
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const error = typeof body?.error === "string" ? body.error : "";
    if (/^verification code/i.test(error)) throw new ProviderHttpError("Ring did not accept that code. Ask Ring for a new one and try again.", response.status, "two_factor");
    throw new ProviderHttpError("Ring did not accept the email or password for the shared account.", response.status, "auth");
  }
  if (response.status === 406) throw new ProviderHttpError("Ring refused the sign-in request itself (406), before checking the email or password. Ring may have changed its interface; nothing was saved.", 406, "refused");
  if (!response.ok) throw new ProviderHttpError(`Ring answered ${response.status} to the sign-in.`, response.status, "refused");
  return { kind: "connected", refreshToken: readGrant(await readJson(response, "Ring sign-in")).refreshToken };
}

/** Renew the sign-in. Ring returns a NEW refresh token every time; the caller must store it before using the access token. */
export async function ringRefresh(deps: ProviderFetchDeps, input: { refreshToken: string; hardwareId: string }): Promise<TokenGrant> {
  const response = await providerFetch(deps, "POST", TOKEN_URL, {
    headers: tokenHeaders(input.hardwareId, ""),
    body: JSON.stringify({ client_id: "ring_official_android", scope: "client", grant_type: "refresh_token", refresh_token: input.refreshToken }),
  });
  if (response.status === 400 || response.status === 401 || response.status === 412) {
    throw new ProviderHttpError("Ring refused the stored sign-in (it was revoked, the shared user was removed, or it expired). Reconnect Ring with a new code.", response.status, "auth");
  }
  if (!response.ok) throw new ProviderHttpError(`Ring answered ${response.status} when renewing the sign-in.`, response.status, "refused");
  return readGrant(await readJson(response, "Ring sign-in renewal"));
}

function bearer(accessToken: string, hardwareId: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, hardware_id: hardwareId, "User-Agent": USER_AGENT, "Content-Type": "application/json", Accept: "application/json" };
}

async function readAuthed(deps: ProviderFetchDeps, method: "GET" | "POST", url: string, accessToken: string, hardwareId: string, what: string, body?: string): Promise<unknown> {
  const response = await providerFetch(deps, method, url, { headers: bearer(accessToken, hardwareId), body });
  if (response.status === 401) throw new ProviderHttpError(`Ring refused the sign-in while reading ${what}.`, 401, "auth");
  if (!response.ok) throw new ProviderHttpError(`Ring answered ${response.status} while reading ${what}. Ring may have changed its interface.`, response.status, "refused");
  return readJson(response, `Ring ${what}`);
}

export function parseRingLocations(body: unknown): ProviderLocation[] {
  const list = Array.isArray((body as { user_locations?: unknown })?.user_locations) ? (body as { user_locations: unknown[] }).user_locations : null;
  if (!list) throw new ProviderHttpError("Ring's location list was not in the expected format. Ring may have changed its interface.", null, "refused");
  return list.flatMap((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    if (typeof row.location_id !== "string") return [];
    const address = (row.address ?? {}) as Record<string, unknown>;
    const parts = [address.address1, address.address2, address.city, address.state, address.zip_code].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    return [{ externalLocationId: row.location_id, name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Ring location", address: parts.length ? parts.join(", ") : null }];
  });
}

function ringBattery(row: Record<string, unknown>): number | null {
  const health = (row.health ?? {}) as Record<string, unknown>;
  const candidates = [row.battery_life, health.battery_percentage];
  for (const value of candidates) {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof number === "number" && Number.isFinite(number)) {
      const rounded = Math.round(number);
      if (isPercent(rounded)) return rounded;
    }
  }
  return null;
}

const CAMERA_GROUPS: Array<{ key: string; kind: ProviderDevice["kind"] }> = [
  { key: "doorbots", kind: "DOORBELL" },
  { key: "authorized_doorbots", kind: "DOORBELL" },
  { key: "stickup_cams", kind: "CAMERA" },
];

/** Cameras and doorbells with their battery and connection. Chimes, base stations and bridges are left out. */
export function parseRingDevices(body: unknown, seenAt: Date): ProviderDevice[] {
  if (!body || typeof body !== "object" || !CAMERA_GROUPS.some((group) => Array.isArray((body as Record<string, unknown>)[group.key]))) {
    throw new ProviderHttpError("Ring's device list was not in the expected format. Ring may have changed its interface.", null, "refused");
  }
  const devices: ProviderDevice[] = [];
  const seen = new Set<string>();
  for (const group of CAMERA_GROUPS) {
    const list = (body as Record<string, unknown>)[group.key];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const row = (raw ?? {}) as Record<string, unknown>;
      const id = typeof row.id === "number" || typeof row.id === "string" ? String(row.id) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const connection = ((row.alerts ?? {}) as Record<string, unknown>).connection;
      const online = connection === "online" ? true : connection === "offline" ? false : null;
      const battery = ringBattery(row);
      const health = (row.health ?? {}) as Record<string, unknown>;
      devices.push({
        externalDeviceId: id,
        externalLocationId: typeof row.location_id === "string" ? row.location_id : null,
        name: typeof row.description === "string" && row.description.trim() ? row.description.trim() : `Ring ${group.kind === "DOORBELL" ? "doorbell" : "camera"} ${id}`,
        kind: group.kind,
        batteryPercent: battery,
        batteryPowered: battery !== null || health.battery_present === true,
        online,
        // An offline device's battery figure is its last report, of unknown age: do not record it as current.
        readAt: battery !== null && online !== false ? seenAt : null,
      });
    }
  }
  return devices;
}

/**
 * One read: renew the sign-in (handing the new refresh token to `persistRotated`
 * BEFORE anything else uses it), open the session, read locations and devices.
 */
export async function ringReadSnapshot(deps: ProviderFetchDeps, input: {
  refreshToken: string;
  hardwareId: string;
  persistRotated: (newRefreshToken: string) => Promise<void>;
  now: () => Date;
}): Promise<ProviderSnapshot> {
  const grant = await ringRefresh(deps, { refreshToken: input.refreshToken, hardwareId: input.hardwareId });
  await input.persistRotated(grant.refreshToken);
  await readAuthed(deps, "POST", SESSION_URL, grant.accessToken, input.hardwareId, "the session", JSON.stringify({
    device: { hardware_id: input.hardwareId, metadata: { api_version: 11, device_model: "sNeek read-only connector" }, os: "android" },
  }));
  const locations = parseRingLocations(await readAuthed(deps, "GET", LOCATIONS_URL, grant.accessToken, input.hardwareId, "locations"));
  const devices = parseRingDevices(await readAuthed(deps, "GET", DEVICES_URL, grant.accessToken, input.hardwareId, "devices"), input.now());
  return { locations, devices };
}
