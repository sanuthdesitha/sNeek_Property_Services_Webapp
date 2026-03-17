import { NextRequest, NextResponse } from "next/server";

const NEXT_AUTH_COOKIES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
];

function firstHeaderValue(value: string | null) {
  if (!value) return "";
  return value.split(",")[0]?.trim() || "";
}

function resolveRequestOrigin(request: NextRequest) {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const host = forwardedHost || firstHeaderValue(request.headers.get("host")) || request.nextUrl.host;
  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "") || "http";
  return `${proto}://${host}`;
}

function resolveSafeCallbackUrl(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("callbackUrl");
  const origin = resolveRequestOrigin(request);
  const allowedHosts = new Set<string>();
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const headerHost = firstHeaderValue(request.headers.get("host"));
  if (forwardedHost) allowedHosts.add(forwardedHost.toLowerCase());
  if (headerHost) allowedHosts.add(headerHost.toLowerCase());
  if (request.nextUrl.host) allowedHosts.add(request.nextUrl.host.toLowerCase());

  if (!requested) {
    return `${origin}/login`;
  }

  try {
    const parsed = new URL(requested, origin);
    if (!allowedHosts.has(parsed.host.toLowerCase())) {
      return `${origin}/login`;
    }
    return parsed.toString();
  } catch {
    return `${origin}/login`;
  }
}

function buildSignOutResponse(request: NextRequest) {
  const response = NextResponse.redirect(resolveSafeCallbackUrl(request));

  for (const cookieName of NEXT_AUTH_COOKIES) {
    response.cookies.set({
      name: cookieName,
      value: "",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
      httpOnly: cookieName.includes("session-token") || cookieName.includes("csrf-token"),
      sameSite: "lax",
      secure: cookieName.startsWith("__Secure-") || cookieName.startsWith("__Host-"),
    });
  }

  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export function GET(request: NextRequest) {
  return buildSignOutResponse(request);
}

export function POST(request: NextRequest) {
  return buildSignOutResponse(request);
}
