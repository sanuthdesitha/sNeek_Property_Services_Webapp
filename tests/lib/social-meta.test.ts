// @vitest-environment node
/**
 * Meta Graph client (social post generator, 2026-11-17) with the HTTP layer
 * injected: no request leaves the test. A post counts only when Meta returns
 * its id; a timeout on the publishing call is "unconfirmed"; a refusal
 * before it is "failed" and nothing became public; code 190 asks for a
 * reconnect; tokens travel only in the Authorization header and never
 * appear in a reason.
 */
import { describe, expect, it, vi } from "vitest";
import { HttpTransportError, sanitizeNetworkText, type HttpRequest, type HttpResponse } from "@/lib/marketing/social/networks/http";
import { checkMetaAccount, exchangeMetaCode, extendMetaUserToken, publishToFacebookPage, publishToInstagram } from "@/lib/marketing/social/networks/meta";

vi.mock("server-only", () => ({}));

type Script = Array<(request: HttpRequest) => HttpResponse | Promise<HttpResponse>>;

function scripted(steps: Script) {
  const calls: HttpRequest[] = [];
  const http = vi.fn(async (request: HttpRequest) => {
    calls.push(request);
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request ${request.method} ${request.url}`);
    return step(request);
  });
  return { http, calls };
}

const ok = (json: unknown): HttpResponse => ({ status: 200, json });
const images = [{ url: "https://app.example/api/public/social-media/t1", altText: "Living room" }, { url: "https://app.example/api/public/social-media/t2", altText: "Bedroom" }];
const noSleep = async () => undefined;

describe("Facebook Page", () => {
  it("one photo: posted only with Meta's id, permalink read afterwards", async () => {
    const { http, calls } = scripted([() => ok({ id: "photo1", post_id: "page_123" }), () => ok({ permalink_url: "https://www.facebook.com/page/posts/123" })]);
    const outcome = await publishToFacebookPage({ http }, { pageId: "page", token: "PAGE-TOKEN", caption: "Hello", images: images.slice(0, 1) });
    expect(outcome).toEqual({ kind: "posted", externalId: "page_123", externalUrl: "https://www.facebook.com/page/posts/123" });
    expect(calls[0]).toMatchObject({ method: "POST", bearer: "PAGE-TOKEN", form: { url: images[0].url, caption: "Hello", alt_text_custom: "Living room", published: "true" } });
    expect(calls.every((call) => !call.url.includes("PAGE-TOKEN"))).toBe(true);
  });

  it("several photos: unpublished uploads, then one feed post with attached_media", async () => {
    const { http, calls } = scripted([() => ok({ id: "m1" }), () => ok({ id: "m2" }), () => ok({ id: "page_9" }), () => ok({ permalink_url: "https://www.facebook.com/x" })]);
    const outcome = await publishToFacebookPage({ http }, { pageId: "page", token: "T", caption: "Carousel", images });
    expect(outcome).toMatchObject({ kind: "posted", externalId: "page_9" });
    expect(calls[2].url).toMatch(/\/page\/feed$/);
    expect(calls[2].form).toMatchObject({ message: "Carousel", "attached_media[0]": JSON.stringify({ media_fbid: "m1" }), "attached_media[1]": JSON.stringify({ media_fbid: "m2" }) });
  });

  it("code 190 asks for a reconnect and says nothing was posted", async () => {
    const { http } = scripted([() => ({ status: 400, json: { error: { message: "Error validating access token: session invalidated EAAGsecretTOKENvalue1234567890abcdef", code: 190 } } })]);
    const outcome = await publishToFacebookPage({ http }, { pageId: "page", token: "T", caption: "x", images: images.slice(0, 1) });
    expect(outcome).toMatchObject({ kind: "failed", code: "TOKEN_INVALID", reconnect: true });
    expect(outcome.kind === "failed" && outcome.reason).toMatch(/Nothing was posted on Facebook/);
  });

  it("a timeout on the publishing call is unconfirmed, never posted", async () => {
    const { http } = scripted([() => { throw new HttpTransportError(true, "timeout"); }]);
    const outcome = await publishToFacebookPage({ http }, { pageId: "page", token: "T", caption: "x", images: images.slice(0, 1) });
    expect(outcome.kind).toBe("unconfirmed");
  });

  it("a failure while uploading the unpublished photos is a failure (nothing public)", async () => {
    const { http } = scripted([() => ok({ id: "m1" }), () => { throw new HttpTransportError(true, "timeout"); }]);
    expect((await publishToFacebookPage({ http }, { pageId: "page", token: "T", caption: "x", images })).kind).toBe("failed");
  });
});

describe("Instagram", () => {
  it("carousel: item containers with alt text, the carousel container, wait for FINISHED, then publish", async () => {
    const { http, calls } = scripted([
      () => ok({ id: "c1" }), () => ok({ id: "c2" }), () => ok({ id: "car" }),
      () => ok({ status_code: "IN_PROGRESS" }), () => ok({ status_code: "FINISHED" }),
      () => ok({ id: "media77" }), () => ok({ permalink: "https://www.instagram.com/p/abc/" }),
    ]);
    const outcome = await publishToInstagram({ http, sleep: noSleep }, { igUserId: "ig1", token: "T", caption: "Cap", images });
    expect(outcome).toEqual({ kind: "posted", externalId: "media77", externalUrl: "https://www.instagram.com/p/abc/" });
    expect(calls[0].form).toMatchObject({ image_url: images[0].url, alt_text: "Living room", is_carousel_item: "true" });
    expect(calls[2].form).toMatchObject({ media_type: "CAROUSEL", children: "c1,c2", caption: "Cap" });
    expect(calls[5].form).toEqual({ creation_id: "car" });
  });

  it("a container that errors fails before anything is published", async () => {
    const { http, calls } = scripted([() => ok({ id: "c1" }), () => ok({ status_code: "ERROR" })]);
    const outcome = await publishToInstagram({ http, sleep: noSleep }, { igUserId: "ig1", token: "T", caption: "Cap", images: images.slice(0, 1) });
    expect(outcome.kind).toBe("failed");
    expect(calls.some((call) => call.url.endsWith("/media_publish"))).toBe(false);
  });

  it("an answer without an id is unconfirmed", async () => {
    const { http } = scripted([() => ok({ id: "c1" }), () => ok({ status_code: "FINISHED" }), () => ok({})]);
    expect((await publishToInstagram({ http, sleep: noSleep }, { igUserId: "ig1", token: "T", caption: "Cap", images: images.slice(0, 1) })).kind).toBe("unconfirmed");
  });
});

describe("connecting and keeping the sign-in", () => {
  it("exchanges the code for a long-lived sign-in and the Page token, with the secret only in a form body", async () => {
    const { http, calls } = scripted([
      () => ok({ access_token: "SHORT" }),
      () => ok({ access_token: "LONG", expires_in: 5_184_000 }),
      () => ok({ data: [{ permission: "pages_manage_posts", status: "granted" }, { permission: "instagram_content_publish", status: "declined" }] }),
      () => ok({ data: [{ id: "p1", name: "sNeek Page", access_token: "PAGE", instagram_business_account: { id: "ig9", username: "sneekproperty" } }] }),
    ]);
    const connection = await exchangeMetaCode({ http }, { appId: "123456", appSecret: "SECRET", redirectUri: "https://app.example/cb", code: "CODE", now: new Date("2026-11-17T00:00:00Z") });
    expect(connection).toMatchObject({ userToken: "LONG", scopes: ["pages_manage_posts"], page: { id: "p1", token: "PAGE" }, instagram: { id: "ig9", username: "sneekproperty" } });
    expect(connection.userTokenExpiresAt?.toISOString()).toBe("2027-01-16T00:00:00.000Z");
    expect(calls.every((call) => !call.url.includes("SECRET") && !call.url.includes("LONG"))).toBe(true);
    expect(calls[0].form).toMatchObject({ client_secret: "SECRET", code: "CODE" });
  });

  it("extending a sign-in Meta refuses for good asks for a reconnect", async () => {
    const { http } = scripted([() => ({ status: 400, json: { error: { message: "expired", code: 190 } } })]);
    expect(await extendMetaUserToken({ http }, { appId: "1", appSecret: "s", userToken: "u" })).toMatchObject({ reconnect: true });
  });

  it("check reads the Instagram publishing limit", async () => {
    const { http } = scripted([() => ok({ username: "sneekproperty" }), () => ok({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] })]);
    expect(await checkMetaAccount({ http }, { network: "INSTAGRAM", externalId: "ig", token: "T" })).toEqual({ ok: true, name: "sneekproperty", publishingLimit: { used: 3, total: 100 } });
  });

  it("removes tokens and long opaque strings from any text it keeps", () => {
    const cleaned = sanitizeNetworkText("Bad access_token=EAAB123 Bearer abc.def EAAGsecretTOKENvalue1234567890abcdefXYZ");
    expect(cleaned).not.toMatch(/EAAB123|abc\.def|EAAGsecret/);
  });
});
