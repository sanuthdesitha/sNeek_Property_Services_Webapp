import "server-only";
/**
 * Minut: official API v8, read-only (2026-11-20).
 *
 * Token: client_credentials with the API client id and secret in HTTP Basic,
 * `POST https://api.minut.com/v8/oauth/token` (developer.minut.com
 * /authentication/user, read 2026-11-20). No refresh token is issued; a new
 * access token is requested when needed.
 * Homes and devices: `GET /v8/homes` → `{ homes: [{ home_id, name, … }] }` and
 * `GET /v8/devices` → `{ devices: [{ device_id, description, home,
 * battery: { percent }, offline, last_heard_from_at }] }`, the fields the
 * open-source Minut client pypoint reads (github.com/fredrike/pypoint,
 * pypoint/__init__.py and const.py). The full reference at
 * api.minut.com/latest/docs could not be read from here (it renders in the
 * browser), so these shapes come from that client and recorded-shape
 * fixtures. NOT run against the real Minut service from this environment.
 */
import { isPercent } from "../charge-policy";
import { ProviderHttpError, providerFetch, readJson, type ProviderFetchDeps } from "./http";
import type { ProviderDevice, ProviderLocation, ProviderSnapshot } from "./types";

const TOKEN_URL = "https://api.minut.com/v8/oauth/token";
const ME_URL = "https://api.minut.com/v8/users/me";
const HOMES_URL = "https://api.minut.com/v8/homes";
const DEVICES_URL = "https://api.minut.com/v8/devices";

export type MinutCredentials = { clientId: string; clientSecret: string };

export async function minutAccessToken(deps: ProviderFetchDeps, credentials: MinutCredentials): Promise<string> {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
  const response = await providerFetch(deps, "POST", TOKEN_URL, {
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", response_type: "token" }).toString(),
  });
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new ProviderHttpError("Minut did not accept the API client id or secret. Check them in Settings, Ring and Minut devices.", response.status, "auth");
  }
  if (!response.ok) throw new ProviderHttpError(`Minut answered ${response.status} to the token request.`, response.status, "refused");
  const body = (await readJson(response, "Minut token")) as Record<string, unknown>;
  if (typeof body.access_token !== "string" || !body.access_token) throw new ProviderHttpError("Minut answered without an access token.", response.status, "refused");
  return body.access_token;
}

async function readAuthed(deps: ProviderFetchDeps, url: string, accessToken: string, what: string): Promise<unknown> {
  const response = await providerFetch(deps, "GET", url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401 || response.status === 403) throw new ProviderHttpError(`Minut refused the token while reading ${what}.`, response.status, "auth");
  if (!response.ok) throw new ProviderHttpError(`Minut answered ${response.status} while reading ${what}.`, response.status, "refused");
  return readJson(response, `Minut ${what}`);
}

/** Check the client id and secret work (token + /users/me). Returns a label for the account. */
export async function minutCheck(deps: ProviderFetchDeps, credentials: MinutCredentials): Promise<string | null> {
  const token = await minutAccessToken(deps, credentials);
  const me = (await readAuthed(deps, ME_URL, token, "the account")) as Record<string, unknown>;
  return typeof me.email === "string" ? me.email : typeof me.fullname === "string" ? me.fullname : null;
}

export function parseMinutHomes(body: unknown): ProviderLocation[] {
  const list = (body as { homes?: unknown })?.homes;
  if (!Array.isArray(list)) throw new ProviderHttpError("Minut's home list was not in the expected format.", null, "refused");
  return list.flatMap((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    if (typeof row.home_id !== "string") return [];
    const location = (row.location ?? row.address ?? {}) as Record<string, unknown>;
    const parts = [location.street_name1, location.street_name2, location.city, location.post_code, location.region].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    return [{ externalLocationId: row.home_id, name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Minut home", address: parts.length ? parts.join(", ") : null }];
  });
}

export function parseMinutDevices(body: unknown): ProviderDevice[] {
  const list = (body as { devices?: unknown })?.devices;
  if (!Array.isArray(list)) throw new ProviderHttpError("Minut's device list was not in the expected format.", null, "refused");
  return list.flatMap((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    if (typeof row.device_id !== "string") return [];
    const battery = (row.battery ?? {}) as Record<string, unknown>;
    const percentRaw = typeof battery.percent === "number" ? Math.round(battery.percent) : null;
    const percent = isPercent(percentRaw) ? percentRaw : null;
    const heardAt = typeof row.last_heard_from_at === "string" ? new Date(row.last_heard_from_at) : null;
    const validHeardAt = heardAt && !Number.isNaN(heardAt.getTime()) ? heardAt : null;
    const offline = typeof row.offline === "boolean" ? row.offline : null;
    return [{
      externalDeviceId: row.device_id,
      externalLocationId: typeof row.home === "string" ? row.home : typeof row.home_id === "string" ? row.home_id : null,
      name: typeof row.description === "string" && row.description.trim() ? row.description.trim() : `Minut sensor ${row.device_id.slice(-6)}`,
      kind: "NOISE_SENSOR" as const,
      batteryPercent: percent,
      batteryPowered: true,
      online: offline === null ? null : !offline,
      // The battery is as of the last time the sensor reported; without that time it is not recorded.
      readAt: percent !== null ? validHeardAt : null,
    }];
  });
}

export async function minutReadSnapshot(deps: ProviderFetchDeps, credentials: MinutCredentials): Promise<ProviderSnapshot> {
  const token = await minutAccessToken(deps, credentials);
  const locations = parseMinutHomes(await readAuthed(deps, HOMES_URL, token, "homes"));
  const devices = parseMinutDevices(await readAuthed(deps, DEVICES_URL, token, "devices"));
  return { locations, devices };
}
