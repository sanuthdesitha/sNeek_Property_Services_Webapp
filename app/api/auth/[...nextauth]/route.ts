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
  const handler = NextAuth(createAuthOptions(baseUrl));
  return handler(request, context as never);
}

export { authHandler as GET, authHandler as POST };
