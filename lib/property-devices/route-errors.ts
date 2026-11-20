import "server-only";
/**
 * One error answer for the device routes (2026-11-20). Messages are ours, in
 * words; a provider error never carries a token, and an unexpected error is
 * redacted (lib/xero/token-service safeReason) before it reaches a response.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { safeReason } from "@/lib/xero/token-service";
import { ProviderHttpError } from "./providers/http";

export const DEVICE_ROUTE_HEADERS = { "Cache-Control": "no-store" };

export function deviceRouteError(error: unknown): NextResponse {
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the details and try again." }, { status: 400, headers: DEVICE_ROUTE_HEADERS });
  if (error instanceof ProviderHttpError) {
    const status = error.kind === "not_allowed" ? 500 : error.kind === "transient" ? 503 : error.kind === "auth" || error.kind === "two_factor" ? 422 : 502;
    return NextResponse.json({ error: error.message, code: error.kind }, { status, headers: DEVICE_ROUTE_HEADERS });
  }
  const message = error instanceof Error ? error.message : "Failed";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: DEVICE_ROUTE_HEADERS });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "You do not have access to this." }, { status: 403, headers: DEVICE_ROUTE_HEADERS });
  if (message === "NOT_FOUND") return NextResponse.json({ error: "Not found." }, { status: 404, headers: DEVICE_ROUTE_HEADERS });
  return NextResponse.json({ error: safeReason(message) }, { status: 400, headers: DEVICE_ROUTE_HEADERS });
}
