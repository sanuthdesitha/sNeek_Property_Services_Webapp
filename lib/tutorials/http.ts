/**
 * Response helpers for the tutorial routes: no-store JSON, the same-origin
 * check on writes, and one mapping from errors to status codes.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { TourInputError } from "./store";

export { isSameOrigin } from "@/lib/inventory/urgent-stock-http";

export const tourJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export function tourFailure(error: unknown) {
  if (error instanceof ZodError) return tourJson({ error: error.issues[0]?.message ?? "Invalid request." }, 400);
  if (error instanceof TourInputError) return tourJson({ error: error.message }, 400);
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return tourJson({ error: "Sign in again." }, 401);
  if (message === "FORBIDDEN") return tourJson({ error: "You do not have access to this." }, 403);
  return tourJson({ error: "Tutorials could not be read or saved just now." }, 500);
}
