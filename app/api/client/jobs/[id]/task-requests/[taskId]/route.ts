import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireClientPortal } from "@/lib/auth/client-portal";
import {
  updateClientJobTaskRequest,
  withdrawClientJobTaskRequest,
} from "@/lib/job-tasks/service";
import { isClientModuleEnabled } from "@/lib/portal-access";

/**
 * Editing and withdrawing a task request you raised.
 *
 * Neither existed before: a client or assistant who mistyped a request could
 * only ask an admin to fix it, and one who changed their mind left a request
 * standing that somebody had to decline by hand.
 *
 * The ownership and already-reviewed rules live in the service, not here, so a
 * second caller cannot arrive later without them — see
 * `loadOwnPendingTaskRequest`. This route contributes the permission gate and
 * the status mapping, and nothing else.
 */

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(4000).optional().nullable(),
  requiresPhoto: z.boolean().optional(),
  requiresNote: z.boolean().optional(),
});

const withdrawSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

function errorStatus(message: string | undefined): number {
  switch (message) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "VA_ACTION_FORBIDDEN":
    case "TASK_NOT_OWN":
      return 403;
    case "TASK_NOT_FOUND":
      return 404;
    // Reviewed between the page loading and the save landing. 409, not 400:
    // nothing about the submission was wrong, the world moved.
    case "TASK_ALREADY_REVIEWED":
      return 409;
    default:
      return 400;
  }
}

const MESSAGES: Record<string, string> = {
  TASK_NOT_FOUND: "That request no longer exists.",
  TASK_NOT_OWN: "You can only change a request you raised yourself.",
  TASK_ALREADY_REVIEWED: "This request has already been reviewed and can no longer be changed.",
  VA_ACTION_FORBIDDEN: "Your access does not allow changing this request.",
  FORBIDDEN: "Your access does not allow changing this request.",
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; taskId: string } }
) {
  try {
    const portal = await requireClientPortal({ permission: "tasksEditOwn" });
    if (!isClientModuleEnabled(portal.visibility, "jobs")) {
      return NextResponse.json({ error: "Jobs are hidden for this client." }, { status: 403 });
    }
    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const updated = await updateClientJobTaskRequest({
      taskId: params.taskId,
      clientId: portal.clientId,
      actorUserId: portal.userId,
      actor: portal.actor,
      ...body,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json(
      { error: MESSAGES[err?.message] ?? "Could not update the request." },
      { status: errorStatus(err?.message) }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; taskId: string } }
) {
  try {
    const portal = await requireClientPortal({ permission: "tasksWithdrawOwn" });
    if (!isClientModuleEnabled(portal.visibility, "jobs")) {
      return NextResponse.json({ error: "Jobs are hidden for this client." }, { status: 403 });
    }
    const body = withdrawSchema.parse(await req.json().catch(() => ({})));
    const updated = await withdrawClientJobTaskRequest({
      taskId: params.taskId,
      clientId: portal.clientId,
      actorUserId: portal.userId,
      actor: portal.actor,
      reason: body.reason ?? null,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json(
      { error: MESSAGES[err?.message] ?? "Could not withdraw the request." },
      { status: errorStatus(err?.message) }
    );
  }
}
