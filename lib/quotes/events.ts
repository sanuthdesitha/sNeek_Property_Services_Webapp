/**
 * Quote activity timeline — server-side event recorder.
 *
 * `recordQuoteEvent` is the single writer used by every touchpoint that mutates
 * a quote's lifecycle: the admin send route, the public accept/decline/add-on
 * routes, the first public view, and the convert-to-job route. It is
 * BEST-EFFORT — it never throws, so it can never break the flow it is called
 * from.
 *
 * Client-safe display metadata (types + labels + icons) lives in
 * `./event-meta` so the timeline component can import it without dragging
 * Prisma / `server-only` into the browser bundle.
 */
import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { QuoteEventType } from "./event-meta";

export type { QuoteEventType } from "./event-meta";
export { QUOTE_EVENT_META } from "./event-meta";

/**
 * Append an event to a quote's activity timeline. Best-effort: swallows every
 * error (logging a warning) so a timeline write can never break an email send,
 * a client response, or a conversion.
 */
export async function recordQuoteEvent(
  quoteId: string,
  type: QuoteEventType,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    await db.quoteEvent.create({
      data: {
        quoteId,
        type,
        // Prisma's Json input is structurally-typed; the detail bag is already
        // plain JSON-serialisable data from the callers.
        detail: (detail ?? undefined) as never,
      },
    });
  } catch (err) {
    try {
      logger.warn({ err, quoteId, type }, "Failed to record quote event");
    } catch {
      // logging is itself best-effort — never let it surface
    }
  }
}
