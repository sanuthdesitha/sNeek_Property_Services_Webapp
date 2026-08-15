import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getClientIp, rateLimit } from "@/lib/security/rate-limit";
import { z } from "zod";

/**
 * Anonymous upload-failure telemetry.
 *
 * Deliberately unauthenticated, and the only unauthenticated write handler on
 * the surface: an upload can fail before or independently of a session (an
 * expired cookie, a guest form), and capturing exactly those is the point. It
 * is internet-facing, so it carries its own limits rather than leaning on a
 * session gate:
 *   - every field is length-capped, so one request cannot store an unbounded blob
 *   - `context` is restricted to scalars and capped on both key count and
 *     serialised size — it was `z.record(z.any())`, which accepts megabytes of
 *     arbitrarily nested JSON
 *   - a per-IP fixed window caps how many rows a single caller can create
 *   - a malformed body answers 400 instead of rejecting out of the handler as
 *     an unhandled 500
 *
 * On the rate limit specifically: getClientIp reads the first x-forwarded-for
 * hop, which a caller can spoof, and the limiter is per-process rather than
 * shared. It raises the cost of flooding but is not a hard guarantee — the
 * field caps are the real bound on what any one request can cost us.
 */

const MAX_CONTEXT_KEYS = 20;
const MAX_CONTEXT_CHARS = 2_000;
const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

/** Context values are diagnostic breadcrumbs, never structures. */
const contextValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

const schema = z.object({
  filename: z.string().trim().max(300),
  size: z.number().int().min(0),
  mime: z.string().trim().max(200),
  reason: z.string().trim().max(200),
  message: z.string().trim().max(2_000).optional(),
  jobId: z.string().trim().max(100).optional(),
  context: z
    .record(contextValue)
    .refine(
      (value) =>
        Object.keys(value).length <= MAX_CONTEXT_KEYS &&
        JSON.stringify(value).length <= MAX_CONTEXT_CHARS,
      `context accepts at most ${MAX_CONTEXT_KEYS} scalar keys and ${MAX_CONTEXT_CHARS} characters`
    )
    .optional(),
});

export async function POST(req: NextRequest) {
  const limit = rateLimit(`upload-failure:${getClientIp(req)}`, RATE_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  // Tag with the session when there is one; absence is expected, not an error.
  const session = await getSession();

  await db.uploadFailure.create({
    data: {
      ...parsed.data,
      userId: session?.user?.id,
    },
  });
  return NextResponse.json({ ok: true });
}
