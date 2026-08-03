import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";

/**
 * TEMPORARY diagnostic sink for the "the page refreshes when I pick a photo"
 * report.
 *
 * Four rounds of inference failed to identify what destroys the page mid-upload,
 * so this stops guessing: the client watchdog reports what actually tore the
 * page down — and, critically, the stack of whatever called reload — straight
 * into the server log. One failed upload should now name the culprit.
 *
 * Deliberately unauthenticated: the page is being destroyed when this fires, so
 * a session round trip is exactly the thing that might not survive. That makes
 * it a public write into the log, so the payload is strictly bounded — a fixed
 * shape, a small size cap, and no caller-controlled log level.
 *
 * Remove once the bug is closed — see docs/SYSTEM.md A6.
 */
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;

const bodySchema = z.object({
  reason: z.string().trim().max(64),
  /** performance navigation type of the load that noticed it, if relevant. */
  navType: z.string().trim().max(32).optional(),
  /** How long the upload had been running when the page died. */
  uploadAgeMs: z.number().int().nonnegative().max(3_600_000).optional(),
  /** Stack captured when something called location.reload(). */
  reloadStack: z.string().trim().max(2000).optional(),
  path: z.string().trim().max(300).optional(),
  ua: z.string().trim().max(300).optional(),
  extra: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    const parsed = bodySchema.safeParse(JSON.parse(raw || "{}"));
    if (!parsed.success) {
      return new NextResponse(null, { status: 204 });
    }

    // warn, not error: expected noise while the bug is open, and it should
    // stand out in the log without paging anyone.
    logger.warn({ uploadWatchdog: parsed.data }, "[upload-watchdog] page torn down during upload");
  } catch {
    // A diagnostic must never become a second fault.
  }
  // 204 so sendBeacon never retries and the client never waits.
  return new NextResponse(null, { status: 204 });
}
