import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { DISPATCH_RECEIPT_PREFIX } from "@/lib/notifications/dispatch-once";
import { summarizeWorkerHeartbeats, WORKER_HEARTBEAT_PREFIX } from "@/lib/ops/worker-heartbeat";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [mobile, receipts, heartbeats] = await Promise.all([
      db.notification.findMany({ where: { channel: "PUSH", externalId: { startsWith: "mobile-outbox:" } },
        select: { id: true, subject: true, externalId: true, errorMsg: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 101 }),
      db.appSetting.findMany({ where: { key: { startsWith: DISPATCH_RECEIPT_PREFIX } }, select: { key: true, value: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 101 }),
      db.appSetting.findMany({ where: { key: { startsWith: WORKER_HEARTBEAT_PREFIX } }, select: { value: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 20 }),
    ]);
    return NextResponse.json({ worker: summarizeWorkerHeartbeats(heartbeats), hasMore: mobile.length > 100 || receipts.length > 100,
      mobile: mobile.slice(0, 100).map(row => ({ id: row.id, subject: row.subject, status: row.externalId?.replace("mobile-outbox:", ""), detail: row.errorMsg, createdAt: row.createdAt })),
      attempts: receipts.slice(0, 100).map(row => { const value = row.value as Record<string, unknown>; return {
        id: row.key, event: value.event, status: value.status, startedAt: value.startedAt, finishedAt: value.finishedAt,
        // A PROCESSING claim left behind by a crashed process also needs review.
        needsReview: value.status === "UNCERTAIN" || (value.status === "PROCESSING" && Date.now() - new Date(String(value.startedAt)).getTime() > 10 * 60_000),
      }; }),
    }, { headers });
  } catch (error) {
    return NextResponse.json({ error: "Delivery status is unavailable." }, { status: getApiErrorStatus(error, 503), headers });
  }
}
