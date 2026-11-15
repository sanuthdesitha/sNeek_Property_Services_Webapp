import "server-only";
import { HttpTransportError, sanitizeNetworkText, sleep as realSleep, type HttpClient, type HttpResponse } from "./http";

/**
 * Meta Graph API client for sNeek's own Facebook Page and Instagram
 * professional account (2026-11-17). Official endpoints only:
 *
 * - Facebook, one photo: POST /{page}/photos (url, caption, alt_text_custom, published=true).
 * - Facebook, several: each photo POST /{page}/photos with published=false,
 *   then POST /{page}/feed with message and attached_media.
 * - Instagram: an image container per photo (POST /{ig}/media with image_url
 *   and alt_text; is_carousel_item for a carousel), a CAROUSEL container for
 *   several, wait until the container is FINISHED, then POST /{ig}/media_publish.
 *
 * A post counts as published only when Meta returns its id. A timeout on the
 * call that makes the post public is "unconfirmed" (check before retrying);
 * a failure before that call is "failed" and nothing became public. Images
 * are fetched by Meta from short-lived signed links to the cleaned copies.
 */

export const META_GRAPH_VERSION = "v24.0";
export const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const META_DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
export { META_SCOPES } from "../meta-scopes";

export type PublishImage = { url: string; altText: string };

export type PublishOutcome =
  | { kind: "posted"; externalId: string; externalUrl: string | null }
  | { kind: "failed"; code: string; reason: string; reconnect: boolean }
  | { kind: "unconfirmed"; reason: string };

export type MetaDeps = { http: HttpClient; sleep?: (ms: number) => Promise<void> };

type GraphError = { code: number | null; subcode: number | null; message: string };

function graphError(response: HttpResponse): GraphError | null {
  if (response.status >= 200 && response.status < 300) {
    const body = response.json as { error?: unknown } | null;
    if (!body || !body.error) return null;
  }
  const error = (response.json as { error?: { code?: unknown; error_subcode?: unknown; message?: unknown } } | null)?.error;
  return {
    code: typeof error?.code === "number" ? error.code : null,
    subcode: typeof error?.error_subcode === "number" ? error.error_subcode : null,
    message: sanitizeNetworkText(error?.message) || `HTTP ${response.status}`,
  };
}

/** A refusal in words, naming the network, and whether a reconnect is needed. */
export function describeMetaError(network: "Facebook" | "Instagram", error: GraphError, nothingPosted = true): { code: string; reason: string; reconnect: boolean } {
  const tail = nothingPosted ? ` Nothing was posted on ${network}.` : "";
  if (error.code === 190) {
    return { code: "TOKEN_INVALID", reconnect: true, reason: `${network} refused: the sign-in was revoked or has expired (code 190). Reconnect in Social accounts.${tail}` };
  }
  if (error.code === 10 || (error.code !== null && error.code >= 200 && error.code < 300)) {
    return { code: "PERMISSION", reconnect: true, reason: `${network} refused: a permission is missing (code ${error.code}). Reconnect and allow every permission listed.${tail}` };
  }
  if (error.code === 4 || error.code === 17 || error.code === 32 || error.code === 613 || error.code === 9) {
    return { code: "RATE_LIMITED", reconnect: false, reason: `${network} refused: too many requests just now (code ${error.code}). Try again later.${tail}` };
  }
  return { code: error.code !== null ? `META_${error.code}` : "META_ERROR", reconnect: false, reason: `${network} refused: ${error.message}${error.code !== null ? ` (code ${error.code})` : ""}.${tail}` };
}

function idOf(response: HttpResponse, key = "id"): string | null {
  const value = (response.json as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && value.length > 0 && value.length < 200 ? value : null;
}

async function call(deps: MetaDeps, method: "GET" | "POST", path: string, token: string, form?: Record<string, string>): Promise<HttpResponse> {
  return deps.http({ method, url: `${META_GRAPH}${path}`, bearer: token, form });
}

function transportFailure(network: "Facebook" | "Instagram", error: unknown, publishing: boolean): PublishOutcome {
  if (publishing && error instanceof HttpTransportError && error.mayHaveArrived) {
    return { kind: "unconfirmed", reason: `Not confirmed: ${network} did not answer in time after sNeek sent the post. Check ${network} before retrying.` };
  }
  if (publishing && !(error instanceof HttpTransportError)) {
    return { kind: "unconfirmed", reason: `Not confirmed: the answer from ${network} could not be read. Check ${network} before retrying.` };
  }
  return { kind: "failed", code: "NETWORK_UNREACHABLE", reconnect: false, reason: `${network} could not be reached. Nothing was posted on ${network}.` };
}

async function permalink(deps: MetaDeps, id: string, token: string, field: "permalink_url" | "permalink"): Promise<string | null> {
  try {
    const response = await call(deps, "GET", `/${encodeURIComponent(id)}?fields=${field}`, token);
    const value = (response.json as Record<string, unknown> | null)?.[field];
    return typeof value === "string" && /^https:\/\//.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function publishToFacebookPage(deps: MetaDeps, input: { pageId: string; token: string; caption: string; images: PublishImage[] }): Promise<PublishOutcome> {
  const page = encodeURIComponent(input.pageId);
  if (input.images.length === 1) {
    let response: HttpResponse;
    try {
      response = await call(deps, "POST", `/${page}/photos`, input.token, { url: input.images[0].url, caption: input.caption, alt_text_custom: input.images[0].altText, published: "true" });
    } catch (error) {
      return transportFailure("Facebook", error, true);
    }
    const error = graphError(response);
    if (error) return { kind: "failed", ...describeMetaError("Facebook", error) };
    const postId = idOf(response, "post_id") ?? idOf(response);
    if (!postId) return { kind: "unconfirmed", reason: "Not confirmed: Facebook answered without a post id. Check the Page before retrying." };
    return { kind: "posted", externalId: postId, externalUrl: await permalink(deps, postId, input.token, "permalink_url") };
  }
  const mediaIds: string[] = [];
  for (const image of input.images) {
    let response: HttpResponse;
    try {
      response = await call(deps, "POST", `/${page}/photos`, input.token, { url: image.url, alt_text_custom: image.altText, published: "false" });
    } catch (error) {
      return transportFailure("Facebook", error, false);
    }
    const error = graphError(response);
    if (error) return { kind: "failed", ...describeMetaError("Facebook", error) };
    const id = idOf(response);
    if (!id) return { kind: "failed", code: "NO_MEDIA_ID", reconnect: false, reason: "Facebook did not return an id for a photo. Nothing was posted on Facebook." };
    mediaIds.push(id);
  }
  const form: Record<string, string> = { message: input.caption, published: "true" };
  mediaIds.forEach((id, index) => {
    form[`attached_media[${index}]`] = JSON.stringify({ media_fbid: id });
  });
  let response: HttpResponse;
  try {
    response = await call(deps, "POST", `/${page}/feed`, input.token, form);
  } catch (error) {
    return transportFailure("Facebook", error, true);
  }
  const error = graphError(response);
  if (error) return { kind: "failed", ...describeMetaError("Facebook", error) };
  const postId = idOf(response);
  if (!postId) return { kind: "unconfirmed", reason: "Not confirmed: Facebook answered without a post id. Check the Page before retrying." };
  return { kind: "posted", externalId: postId, externalUrl: await permalink(deps, postId, input.token, "permalink_url") };
}

async function waitForContainer(deps: MetaDeps, containerId: string, token: string): Promise<GraphError | "ready" | "timeout"> {
  const pause = deps.sleep ?? realSleep;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await call(deps, "GET", `/${encodeURIComponent(containerId)}?fields=status_code`, token);
    const error = graphError(response);
    if (error) return error;
    const status = (response.json as { status_code?: unknown } | null)?.status_code;
    if (status === "FINISHED") return "ready";
    if (status === "ERROR" || status === "EXPIRED") return { code: null, subcode: null, message: `the photo could not be prepared (${String(status).toLowerCase()})` };
    await pause(2000);
  }
  return "timeout";
}

/** The containers for the photos (and the carousel), ready to publish, or why not. */
async function prepareInstagram(deps: MetaDeps, input: { igUserId: string; token: string; caption: string; images: PublishImage[] }): Promise<{ containerId: string } | PublishOutcome> {
  const ig = encodeURIComponent(input.igUserId);
  const carousel = input.images.length > 1;
  const children: string[] = [];
  try {
    for (const image of input.images) {
      const form: Record<string, string> = { image_url: image.url, alt_text: image.altText };
      if (carousel) form.is_carousel_item = "true";
      else form.caption = input.caption;
      const response = await call(deps, "POST", `/${ig}/media`, input.token, form);
      const error = graphError(response);
      if (error) return { kind: "failed", ...describeMetaError("Instagram", error) };
      const id = idOf(response);
      if (!id) return { kind: "failed", code: "NO_CONTAINER", reconnect: false, reason: "Instagram did not return an id for a photo. Nothing was posted on Instagram." };
      children.push(id);
    }
    let containerId = children[0];
    if (carousel) {
      const response = await call(deps, "POST", `/${ig}/media`, input.token, { media_type: "CAROUSEL", children: children.join(","), caption: input.caption });
      const error = graphError(response);
      if (error) return { kind: "failed", ...describeMetaError("Instagram", error) };
      const id = idOf(response);
      if (!id) return { kind: "failed", code: "NO_CONTAINER", reconnect: false, reason: "Instagram did not return an id for the carousel. Nothing was posted on Instagram." };
      containerId = id;
    }
    const ready = await waitForContainer(deps, containerId, input.token);
    if (ready === "timeout") return { kind: "failed", code: "CONTAINER_NOT_READY", reconnect: false, reason: "Instagram was still preparing the photos after 12 seconds. Nothing was posted on Instagram; try again." };
    if (ready !== "ready") return { kind: "failed", ...describeMetaError("Instagram", ready) };
    return { containerId };
  } catch (error) {
    return transportFailure("Instagram", error, false);
  }
}

export async function publishToInstagram(deps: MetaDeps, input: { igUserId: string; token: string; caption: string; images: PublishImage[] }): Promise<PublishOutcome> {
  const prepared = await prepareInstagram(deps, input);
  if ("kind" in prepared) return prepared;
  let response: HttpResponse;
  try {
    response = await call(deps, "POST", `/${encodeURIComponent(input.igUserId)}/media_publish`, input.token, { creation_id: prepared.containerId });
  } catch (error) {
    return transportFailure("Instagram", error, true);
  }
  const error = graphError(response);
  if (error) return { kind: "failed", ...describeMetaError("Instagram", error) };
  const mediaId = idOf(response);
  if (!mediaId) return { kind: "unconfirmed", reason: "Not confirmed: Instagram answered without a post id. Check Instagram before retrying." };
  return { kind: "posted", externalId: mediaId, externalUrl: await permalink(deps, mediaId, input.token, "permalink") };
}

export type MetaConnection = {
  userToken: string;
  userTokenExpiresAt: Date | null;
  scopes: string[];
  page: { id: string; name: string; token: string };
  instagram: { id: string; username: string } | null;
  otherPages: number;
};

export class MetaConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaConnectError";
  }
}

async function expectOk(response: HttpResponse, what: string): Promise<Record<string, unknown>> {
  const error = graphError(response);
  if (error) throw new MetaConnectError(`${what}: ${describeMetaError("Facebook", error, false).reason}`);
  return (response.json ?? {}) as Record<string, unknown>;
}

/**
 * The connect flow after Facebook's own sign-in page: code → short sign-in →
 * long-lived sign-in → the Page (and its Instagram account) with a Page
 * token, which has no fixed expiry. The app secret is sent in a form body
 * from the server only.
 */
export async function exchangeMetaCode(deps: MetaDeps, input: { appId: string; appSecret: string; redirectUri: string; code: string; now?: Date }): Promise<MetaConnection> {
  const now = input.now ?? new Date();
  const short = await expectOk(await deps.http({ method: "POST", url: `${META_GRAPH}/oauth/access_token`, form: { client_id: input.appId, client_secret: input.appSecret, redirect_uri: input.redirectUri, code: input.code } }), "Facebook did not accept the sign-in");
  const shortToken = typeof short.access_token === "string" ? short.access_token : null;
  if (!shortToken) throw new MetaConnectError("Facebook did not return a sign-in.");
  const long = await expectOk(await deps.http({ method: "POST", url: `${META_GRAPH}/oauth/access_token`, form: { grant_type: "fb_exchange_token", client_id: input.appId, client_secret: input.appSecret, fb_exchange_token: shortToken } }), "Facebook did not extend the sign-in");
  const userToken = typeof long.access_token === "string" ? long.access_token : shortToken;
  const expiresIn = typeof long.expires_in === "number" ? long.expires_in : null;
  const permissions = await expectOk(await call(deps, "GET", "/me/permissions", userToken), "Facebook did not list the permissions");
  const scopes = Array.isArray(permissions.data)
    ? (permissions.data as Array<{ permission?: unknown; status?: unknown }>).filter((row) => row.status === "granted" && typeof row.permission === "string").map((row) => row.permission as string)
    : [];
  const accounts = await expectOk(await call(deps, "GET", "/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}", userToken), "Facebook did not list your Pages");
  const pages = Array.isArray(accounts.data) ? (accounts.data as Array<Record<string, unknown>>) : [];
  const usable = pages.filter((page) => typeof page.id === "string" && typeof page.name === "string" && typeof page.access_token === "string");
  if (usable.length === 0) throw new MetaConnectError("No Facebook Page was shared with sNeek. Connect again and tick the sNeek Page.");
  const chosen = usable.find((page) => (page.instagram_business_account as { id?: unknown } | undefined)?.id) ?? usable[0];
  const igAccount = chosen.instagram_business_account as { id?: unknown; username?: unknown } | undefined;
  return {
    userToken,
    userTokenExpiresAt: expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null,
    scopes,
    page: { id: chosen.id as string, name: chosen.name as string, token: chosen.access_token as string },
    instagram: typeof igAccount?.id === "string" ? { id: igAccount.id, username: typeof igAccount.username === "string" ? igAccount.username : "Instagram account" } : null,
    otherPages: usable.length - 1,
  };
}

/** Extends a still-valid long-lived sign-in (Meta allows this while it is valid). */
export async function extendMetaUserToken(deps: MetaDeps, input: { appId: string; appSecret: string; userToken: string; now?: Date }): Promise<{ token: string; expiresAt: Date | null } | { error: string; reconnect: boolean }> {
  const response = await deps.http({ method: "POST", url: `${META_GRAPH}/oauth/access_token`, form: { grant_type: "fb_exchange_token", client_id: input.appId, client_secret: input.appSecret, fb_exchange_token: input.userToken } });
  const error = graphError(response);
  if (error) {
    const described = describeMetaError("Facebook", error, false);
    return { error: described.reason, reconnect: described.reconnect };
  }
  const body = (response.json ?? {}) as Record<string, unknown>;
  if (typeof body.access_token !== "string") return { error: "Facebook did not return a sign-in.", reconnect: false };
  const now = input.now ?? new Date();
  return { token: body.access_token, expiresAt: typeof body.expires_in === "number" ? new Date(now.getTime() + body.expires_in * 1000) : null };
}

export type MetaCheck = { ok: true; name: string; publishingLimit: { used: number | null; total: number | null } | null } | { ok: false; reason: string; reconnect: boolean };

/** Reads the Page name (and, for Instagram, the 24-hour publishing limit) to prove the sign-in works. */
export async function checkMetaAccount(deps: MetaDeps, input: { network: "FACEBOOK" | "INSTAGRAM"; externalId: string; token: string }): Promise<MetaCheck> {
  try {
    const id = encodeURIComponent(input.externalId);
    if (input.network === "FACEBOOK") {
      const response = await call(deps, "GET", `/${id}?fields=name`, input.token);
      const error = graphError(response);
      if (error) {
        const described = describeMetaError("Facebook", error, false);
        return { ok: false, reason: described.reason, reconnect: described.reconnect };
      }
      return { ok: true, name: String((response.json as { name?: unknown }).name ?? "Facebook Page"), publishingLimit: null };
    }
    const profile = await call(deps, "GET", `/${id}?fields=username`, input.token);
    const profileError = graphError(profile);
    if (profileError) {
      const described = describeMetaError("Instagram", profileError, false);
      return { ok: false, reason: described.reason, reconnect: described.reconnect };
    }
    const limit = await call(deps, "GET", `/${id}/content_publishing_limit?fields=quota_usage,config`, input.token);
    const data = ((limit.json as { data?: unknown[] } | null)?.data?.[0] ?? null) as { quota_usage?: unknown; config?: { quota_total?: unknown } } | null;
    return {
      ok: true,
      name: String((profile.json as { username?: unknown }).username ?? "Instagram account"),
      publishingLimit: graphError(limit) || !data ? null : { used: typeof data.quota_usage === "number" ? data.quota_usage : null, total: typeof data.config?.quota_total === "number" ? data.config.quota_total : null },
    };
  } catch {
    return { ok: false, reason: "Meta could not be reached. The connection was not changed.", reconnect: false };
  }
}

/** Removes sNeek's permissions at Meta (the user's own app grant). */
export async function revokeMetaPermissions(deps: MetaDeps, userToken: string): Promise<boolean> {
  try {
    const response = await deps.http({ method: "DELETE", url: `${META_GRAPH}/me/permissions`, bearer: userToken });
    return !graphError(response) && (response.json as { success?: unknown } | null)?.success === true;
  } catch {
    return false;
  }
}
