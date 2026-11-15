import "server-only";
import { randomInt } from "node:crypto";
import type { HttpClient, HttpRequest } from "./http";

/**
 * A stand-in for the Meta Graph API that makes NO network call (2026-11-17).
 * Used only outside production when SNEEK_SOCIAL_NETWORK_STUB is set, for
 * local inspection of the posting flow: "ok" answers like a successful post;
 * "fail-facebook" refuses Facebook with code 190 (revoked sign-in). Never a
 * substitute for testing against the owner's real accounts.
 */
export function stubHttpClient(mode: string): HttpClient {
  return async (request: HttpRequest) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const id = () => `${randomInt(10_000_000, 99_999_999)}${randomInt(10_000_000, 99_999_999)}`;
    if (mode === "fail-facebook" && /\/(photos|feed)$/.test(path)) {
      return { status: 400, json: { error: { message: "Error validating access token: The session has been invalidated.", code: 190 } } };
    }
    if (path.endsWith("/photos")) return { status: 200, json: request.form?.published === "false" ? { id: id() } : { id: id(), post_id: `${id()}_${id()}` } };
    if (path.endsWith("/feed")) return { status: 200, json: { id: `${id()}_${id()}` } };
    if (path.endsWith("/media")) return { status: 200, json: { id: id() } };
    if (path.endsWith("/media_publish")) return { status: 200, json: { id: id() } };
    if (url.searchParams.get("fields") === "status_code") return { status: 200, json: { status_code: "FINISHED" } };
    if (url.searchParams.get("fields") === "permalink_url") return { status: 200, json: { permalink_url: `https://www.facebook.com/stub/posts/${path.split("/").pop()}` } };
    if (url.searchParams.get("fields") === "permalink") return { status: 200, json: { permalink: `https://www.instagram.com/p/stub${path.split("/").pop()?.slice(-6)}/` } };
    if (path.endsWith("/content_publishing_limit")) return { status: 200, json: { data: [{ quota_usage: 3, config: { quota_total: 100 } }] } };
    if (url.searchParams.get("fields") === "name") return { status: 200, json: { name: "sNeek Property Services (stub)" } };
    if (url.searchParams.get("fields") === "username") return { status: 200, json: { username: "sneekproperty" } };
    return { status: 404, json: { error: { message: "Not handled by the local stub", code: 100 } } };
  };
}
