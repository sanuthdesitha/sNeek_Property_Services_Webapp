import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { reviewNotificationIntent } from "@/lib/notifications/intent-review";
import { NotificationIntentError } from "@/lib/notifications/intent-store";
import { notificationEnvelopeSchema } from "@/lib/notifications/intent-contract";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(request: Request) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const status = new URL(request.url).searchParams.get("status") ?? "ATTENTION";
    if (!["ATTENTION", "QUEUED", "ACCEPTED", "SKIPPED"].includes(status)) return NextResponse.json({ error: "Invalid status filter." }, { status: 400, headers });
    const rows = await db.notificationIntent.findMany({
      where: { status: { in: status === "ATTENTION" ? ["FAILED", "UNCERTAIN"] : status === "QUEUED" ? ["QUEUED", "RETRY_WAIT", "PROCESSING"] : [status] } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 101,
      include: { attempts: { orderBy: { number: "asc" } } },
    });
    return NextResponse.json({ hasMore: rows.length > 100, items: rows.slice(0, 100).map(row => {
      const parsed = notificationEnvelopeSchema.safeParse(row.envelope);
      return { id: row.id, eventKey: row.eventKey, recipientId: row.recipientId, transport: row.transport, status: row.status,
        subject: parsed.success ? parsed.data.subject : null, severity: parsed.success ? parsed.data.severity : null,
        attemptCount: row.attemptCount, nextAttemptAt: row.nextAttemptAt, updatedAt: row.updatedAt, lastErrorCode: row.lastErrorCode,
        attempts: row.attempts.map(attempt => ({ number: attempt.number, status: attempt.status, providerReference: attempt.providerReference, errorCode: attempt.errorCode, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt })) };
    }) }, { headers });
  } catch (error) { return NextResponse.json({ error: "Could not load delivery intents." }, { status: getApiErrorStatus(error, 503), headers }); }
}
export async function PATCH(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ error: "Delivery review is disabled while impersonating." }, { status: 403, headers });
    const result = await reviewNotificationIntent(session.user.id, await request.json());
    return NextResponse.json({ id: result.id, status: result.status, updatedAt: result.updatedAt }, { headers });
  } catch (error) {
    const status = error instanceof NotificationIntentError ? error.status : getApiErrorStatus(error, 400);
    return NextResponse.json({ error: error instanceof NotificationIntentError ? error.message : "Could not save delivery review." }, { status, headers });
  }
}
