import { NextResponse } from "next/server";
import { retainedContextId, retainedRequestSecrets, retainedSecretCookie } from "@/lib/auth/retained-context";
import { revokeRetainedAccount } from "@/lib/auth/retained-accounts";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { createAuthOptions } from "@/lib/auth/auth-options";

function getRequestBaseUrl(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "") || "http";
  return `${protocol}://${host}`;
}

async function authHandler(request: NextRequest, context: unknown) {
  const baseUrl = getRequestBaseUrl(request);
  const retained = retainedContextId();
  if (retained && request.nextUrl.pathname.endsWith("/signout") && request.method === "POST") {
    if (request.headers.get("origin") !== baseUrl) return NextResponse.json({ error: "Same-origin confirmation required" }, { status: 403 });
    try { await revokeRetainedAccount(retainedRequestSecrets()); } catch { /* Expired already denies access. */ }
    const response = NextResponse.json({ url: `${baseUrl}/accounts` });
    response.cookies.set(retainedSecretCookie(retained), "", { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: 0 });
    return response;
  }
  const handler = NextAuth(createAuthOptions(baseUrl));
  return handler(request, context as never);
}

export { authHandler as GET, authHandler as POST };
