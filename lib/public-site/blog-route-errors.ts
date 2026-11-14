import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Plain-words refusals for the admin blog routes (never a raw code). */
export function blogRouteError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "Your account cannot change blog posts." }, { status: 403 });
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.path.join(".") || "post";
    return NextResponse.json({ error: `Check the ${field}: ${issue?.message ?? "it is not valid"}.` }, { status: 400 });
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === "P2002") return NextResponse.json({ error: "Another post already uses this address. Change the address and try again." }, { status: 409 });
  if (code === "P2025") return NextResponse.json({ error: "This post no longer exists." }, { status: 404 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
