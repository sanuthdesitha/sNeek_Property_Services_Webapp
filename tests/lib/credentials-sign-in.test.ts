// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { signInWithCredentials } from "@/lib/auth/credentials-sign-in";

// Exercise the installed v4 implementation, including its real CSRF gate.
const require = createRequire(import.meta.url);
const { AuthHandler } = require(path.join(path.dirname(require.resolve("next-auth")), "core/index.js"));
const origin = "http://localhost:3000";
const input = { email: "fixture@example.invalid", password: "test-only", callbackUrl: `${origin}/v2` };
afterEach(() => vi.unstubAllGlobals());

async function authFixture(race: boolean, allowed = true) {
  const authorize = vi.fn(async () => allowed ? { id: "fixture", email: input.email } : null);
  const options: NextAuthOptions = {
    secret: "isolated-test-secret-never-used-by-the-app",
    useSecureCookies: false,
    session: { strategy: "jwt" },
    pages: { signIn: "/login", error: "/login" },
    providers: [CredentialsProvider({ credentials: {}, authorize })],
    logger: { warn: () => {}, error: () => {}, debug: () => {} },
  };
  let cookies: Record<string, string> = {};
  const call = (action: string, snapshot: Record<string, string>, body?: Record<string, string>) => AuthHandler({
    options,
    req: { action, providerId: action === "callback" ? "credentials" : undefined,
      method: body ? "POST" : "GET", cookies: snapshot, body, query: {},
      headers: { host: "localhost:3000" } },
  });
  const applyCookies = (result: { cookies?: { name: string; value: string }[] }) => {
    for (const cookie of result.cookies ?? []) cookies[cookie.name] = cookie.value;
  };
  // SessionProvider's initial request starts without cookies but finishes after /csrf.
  const lateSession = race ? await call("session", {}) : null;
  const rejected: boolean[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/csrf") {
      const result = await call("csrf", { ...cookies });
      applyCookies(result);
      if (lateSession && fetchMock.mock.calls.length === 1) applyCookies(lateSession);
      return Response.json(result.body);
    }
    const result = await call("callback", { ...cookies }, Object.fromEntries(new URLSearchParams(init?.body as URLSearchParams)));
    applyCookies(result);
    rejected.push(result.redirect?.includes("csrf=true") === true);
    if (rejected.at(-1)) expect(authorize).not.toHaveBeenCalled();
    // Same JSON redirect conversion as next-auth/next's App Router handler.
    return Response.json({ url: result.redirect }, { status: result.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { authorize, rejected, fetchMock, hasSession: () => Boolean(cookies["next-auth.session-token"]) };
}

describe("credentials sign-in", () => {
  it("recovers once when a late first-session response replaces the CSRF cookie", async () => {
    const fixture = await authFixture(true);
    const result = await signInWithCredentials(input);
    expect(fixture.rejected).toEqual([true, false]);
    expect(fixture.authorize).toHaveBeenCalledTimes(1);
    expect(fixture.hasSession()).toBe(true);
    expect(result).toMatchObject({ ok: true, url: input.callbackUrl });
  });

  it("signs in once without a cookie race", async () => {
    const fixture = await authFixture(false);
    expect(await signInWithCredentials(input)).toMatchObject({ ok: true, url: input.callbackUrl });
    expect(fixture.authorize).toHaveBeenCalledTimes(1);
    expect(fixture.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a provider denial (credentials, second factor, or account gates)", async () => {
    const fixture = await authFixture(false, false);
    expect(await signInWithCredentials(input)).toMatchObject({ ok: false });
    expect(fixture.authorize).toHaveBeenCalledTimes(1);
    expect(fixture.hasSession()).toBe(false);
    expect(fixture.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after a second explicit CSRF rejection", async () => {
    const fetchMock = vi.fn(async (url: string) => Response.json(url.endsWith("csrf")
      ? { csrfToken: "fixture-token" }
      : { url: `${origin}/api/auth/signin?csrf=true` }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(signInWithCredentials(input)).rejects.toThrow("Could not initialize sign in.");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a transport failure or resend credentials after an uncertain result", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: "fixture-token" }))
      .mockRejectedValueOnce(new Error("Network failure"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(signInWithCredentials(input)).rejects.toThrow("Network failure");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([null, {}, { csrfToken: "" }])("never posts credentials without a CSRF token: %j", async (body) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetchMock);
    await expect(signInWithCredentials(input)).rejects.toThrow("Missing CSRF token.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an HTTP failure even if its URL contains csrf=true", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: "fixture-token" }))
      .mockResolvedValueOnce(Response.json({ url: `${origin}/api/auth/signin?csrf=true` }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await signInWithCredentials(input)).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([{}, { url: "/v2/login?callbackUrl=%2Fv2" }, { url: "/api/auth/signin" }])(
    "does not treat an incomplete/auth-page response as successful: %j", async (body) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: "fixture-token" }))
        .mockResolvedValueOnce(Response.json(body));
      vi.stubGlobal("fetch", fetchMock);
      await expect(signInWithCredentials(input)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
});
