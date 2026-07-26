import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  APPROVAL_DECISION_ACTION,
  approvalCapabilities,
  approvalEntityHref,
  isApprovalQueueKey,
  parseApprovalDecisionPayload,
  type ApprovalItemState,
} from "@/lib/admin/approval-history";

/**
 * GET /api/admin/approvals/history
 *
 * The Approval Center's decision history, read straight out of `AuditLog` —
 * every approve / decline / dismiss / reverse / edit / delete across all fifteen
 * queues, written under the single `APPROVAL_DECISION` action by
 * lib/admin/approval-history-write.ts.
 *
 * Filters: ?queue= &deciderId= &from=YYYY-MM-DD &to=YYYY-MM-DD &q= &limit= &cursor=
 *
 * Each row carries the capability set for the underlying item, so the UI only
 * offers verbs the server will actually honour. Live state (settled stamps,
 * current status) is re-read for the money-backed rows rather than trusted from
 * the audit payload — a row settled AFTER the decision must be immutable now.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);

    const queue = searchParams.get("queue");
    const deciderId = searchParams.get("deciderId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const search = (searchParams.get("q") ?? "").trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 100) || 100));
    const cursor = searchParams.get("cursor");

    const createdAt: Record<string, Date> = {};
    if (from) {
      const d = new Date(`${from}T00:00:00+10:00`);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(`${to}T23:59:59.999+10:00`);
      if (!Number.isNaN(d.getTime())) createdAt.lte = d;
    }

    const rows = await db.auditLog.findMany({
      where: {
        action: APPROVAL_DECISION_ACTION,
        ...(deciderId ? { userId: deciderId } : {}),
        ...(Object.keys(createdAt).length ? { createdAt: createdAt as any } : {}),
      },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      // The queue and free-text filters live inside the JSON payload, so a
      // over-fetch + in-memory filter is the honest approach here: filtering on
      // a Json path in Postgres via Prisma would not use an index either, and
      // this keeps the shape identical to what parseApprovalDecisionPayload
      // guarantees.
      take: queue || search ? Math.min(1000, limit * 6) : limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const parsed = rows
      .map((row) => {
        const payload = parseApprovalDecisionPayload(row.after);
        if (!payload) return null;
        return { row, payload };
      })
      .filter((entry): entry is { row: (typeof rows)[number]; payload: NonNullable<ReturnType<typeof parseApprovalDecisionPayload>> } =>
        Boolean(entry)
      )
      .filter((entry) => (queue && isApprovalQueueKey(queue) ? entry.payload.approvalQueue === queue : true))
      .filter((entry) => {
        if (!search) return true;
        const haystack = [
          entry.payload.label,
          entry.payload.note,
          entry.payload.subjectName,
          entry.row.user?.name,
          entry.row.user?.email,
          entry.row.entityId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      });

    const page = parsed.slice(0, limit);
    const hasMore = parsed.length > limit || rows.length > limit;

    // Live state for the money-backed rows — the ONLY entity whose settlement
    // stamps can flip after the decision was recorded.
    const adjustmentIds = Array.from(
      new Set(
        page
          .filter((entry) => entry.row.entity === "CleanerPayAdjustment")
          .map((entry) => entry.row.entityId)
      )
    );
    const adjustments = adjustmentIds.length
      ? await db.cleanerPayAdjustment.findMany({
          where: { id: { in: adjustmentIds } },
          select: {
            id: true,
            status: true,
            approvedAmount: true,
            requestedAmount: true,
            includedInPayrollRunId: true,
            includedInCleanerInvoiceId: true,
          },
        })
      : [];
    const adjustmentMap = new Map(adjustments.map((row) => [row.id, row]));

    const items = page.map(({ row, payload }) => {
      let state: ApprovalItemState = {};
      if (row.entity === "CleanerPayAdjustment") {
        const live = adjustmentMap.get(row.entityId);
        state = live
          ? {
              status: live.status,
              includedInPayrollRunId: live.includedInPayrollRunId,
              includedInCleanerInvoiceId: live.includedInCleanerInvoiceId,
            }
          : { missing: true };
      } else if (payload.toStatus) {
        state = { status: payload.toStatus };
      }

      const live = adjustmentMap.get(row.entityId);
      return {
        id: row.id,
        createdAt: row.createdAt,
        queue: payload.approvalQueue,
        decision: payload.decision,
        entity: row.entity,
        entityId: row.entityId,
        jobId: row.jobId,
        label: payload.label,
        amount: payload.amount,
        value: payload.value,
        note: payload.note,
        subjectName: payload.subjectName,
        subjectUserId: payload.subjectUserId,
        fromStatus: payload.fromStatus,
        toStatus: payload.toStatus,
        decidedBy: row.user
          ? { id: row.user.id, name: row.user.name, email: row.user.email, role: row.user.role }
          : null,
        href: approvalEntityHref(payload.approvalQueue, row.entityId, row.jobId),
        /** Live status of the underlying row (money queues only; else the recorded one). */
        currentStatus: live?.status ?? payload.toStatus ?? null,
        currentAmount: live ? Number(live.approvedAmount ?? live.requestedAmount ?? 0) : null,
        settled: Boolean(live?.includedInPayrollRunId || live?.includedInCleanerInvoiceId),
        capabilities: approvalCapabilities(payload.approvalQueue, state),
      };
    });

    return NextResponse.json({
      items,
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1].row.id : null,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Could not load history." }, { status });
  }
}
