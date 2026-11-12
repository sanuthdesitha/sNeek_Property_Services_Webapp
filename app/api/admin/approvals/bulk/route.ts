import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { APPROVALS_BULK_MAX_IDS, APPROVAL_QUEUE_ORDER } from "@/lib/admin/approvals/queues";
import {
  BulkDecisionNotAllowed,
  runBulkDecision,
  type DecisionInvoker,
  type DecisionTarget,
} from "@/lib/admin/approvals/bulk";
import { PATCH as patchPayAdjustment } from "@/app/api/admin/pay-adjustments/[id]/route";
import { PATCH as patchTimeAdjustment } from "@/app/api/admin/time-adjustments/[id]/route";
import { PATCH as patchTiming } from "@/app/api/admin/job-early-checkouts/[id]/route";
import { PATCH as patchCleanerInvoice } from "@/app/api/admin/cleaner-invoices/[id]/route";
import { PATCH as patchClientApproval } from "@/app/api/admin/client-approvals/[id]/route";
import { PATCH as patchJobTask } from "@/app/api/admin/job-tasks/[id]/route";
import { PATCH as patchSkip } from "@/app/api/admin/jobs/[id]/skip/route";
import { PATCH as patchQaRework } from "@/app/api/admin/qa/rework-transfers/[id]/route";
import { POST as postQaOutcomes } from "@/app/api/admin/qa/outcomes/route";
import { PATCH as patchQaIssue } from "@/app/api/admin/qa/issues/[id]/route";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  queue: z.enum(APPROVAL_QUEUE_ORDER),
  decision: z.enum(["approve", "decline"]),
  ids: z.array(z.string().min(1).max(64)).min(1).max(APPROVALS_BULK_MAX_IDS),
  note: z.string().trim().max(2000).optional().nullable(),
  noteVisibleToPayee: z.boolean().optional(),
  /** Pay requests approved as asked: the amount confirmed for each id (refused per row when it changed). */
  expectedAmounts: z.record(z.string().min(1).max(64), z.number().finite().nonnegative()).optional(),
});

type RouteContext = { params: { id: string } };
type ItemHandler = (req: NextRequest, context: RouteContext) => Promise<Response>;

/** The existing single-decision handlers, by target. */
const ITEM_HANDLERS: Record<Exclude<DecisionTarget, "qaOutcome">, ItemHandler> = {
  payAdjustment: patchPayAdjustment,
  timeAdjustment: patchTimeAdjustment,
  timing: patchTiming,
  cleanerInvoice: patchCleanerInvoice,
  clientApproval: patchClientApproval,
  jobTask: patchJobTask,
  skip: patchSkip,
  qaRework: patchQaRework,
  qaIssue: patchQaIssue,
};

function invokerFor(origin: string): DecisionInvoker {
  return async (request) => {
    const init = { method: request.method, body: JSON.stringify(request.body), headers: { "content-type": "application/json" } };
    const itemRequest = new NextRequest(new URL(request.path, origin), init);
    const response =
      request.target === "qaOutcome"
        ? await postQaOutcomes(itemRequest)
        : await ITEM_HANDLERS[request.target](itemRequest, { params: request.params ?? { id: "" } });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };
}

/**
 * POST /api/admin/approvals/bulk { queue, decision, ids, note?, noteVisibleToPayee? }
 *
 * One request for several decisions in one queue; answers a result per row.
 * ADMIN and OPS_MANAGER, like every single decision; each row is then decided
 * by the queue's own route handler with its own guards (lib/admin/approvals/bulk).
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Send a queue, approve or decline, and 1 to ${APPROVALS_BULK_MAX_IDS} request ids.` }, { status: 400 });
  }
  try {
    const result = await runBulkDecision({
      ...parsed.data,
      actor: { id: session.user.id, role: String(session.user.role), heldRoles: session.user.heldRoles?.map(String) },
      invoke: invokerFor(req.url),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BulkDecisionNotAllowed) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Could not apply these decisions." }, { status: 500 });
  }
}
