import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { createClientLightRequest } from "@/lib/job-tasks/service";
import {
  CLIENT_REQUEST_TYPES,
  clientRequestMeta,
  hasOpenRequestOfType,
  isOpenClientRequest,
} from "@/lib/job-tasks/client-requests";

const createSchema = z.object({
  type: z.enum(CLIENT_REQUEST_TYPES),
  note: z.string().trim().max(2000).optional().nullable(),
});

export const dynamic = "force-dynamic";

async function loadScopedJob(
  jobId: string,
  scope: { clientId: string; propertyIds: string[] | null }
) {
  return db.job.findFirst({
    // Scope-aware, not clientId-alone: a scoped VA must not resolve jobs on
    // their client's ungranted properties.
    where: { id: jobId, property: propertyScopeWhere(scope) },
    select: {
      id: true,
      report: { select: { clientVisible: true } },
    },
  });
}

async function loadClientRequestTasks(jobId: string, clientId: string) {
  const tasks = await db.jobTask.findMany({
    where: { jobId, clientId, source: "CLIENT" },
    select: {
      id: true,
      metadata: true,
      approvalStatus: true,
      executionStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return tasks.filter((task) => clientRequestMeta(task) !== null);
}

/** GET → this job's client light-requests (open ones drive hub pending states). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
        const portal = await requireClientPortal({ permission: "bookings" });
    if (!isClientModuleEnabled(portal.visibility, "jobs")) {
      return NextResponse.json({ error: "Jobs are hidden for this client." }, { status: 403 });
    }
    const job = await loadScopedJob(params.id, portal);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const tasks = await loadClientRequestTasks(params.id, portal.clientId);
    return NextResponse.json({
      requests: tasks.map((task) => ({
        id: task.id,
        requestType: clientRequestMeta(task)!.requestType,
        note: clientRequestMeta(task)!.note,
        approvalStatus: task.approvalStatus,
        executionStatus: task.executionStatus,
        open: isOpenClientRequest(task),
        createdAt: task.createdAt,
      })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load requests." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}

/**
 * POST { type: "UPDATE"|"ETA"|"REPORT", note? }
 *   → 409 when an open request of the same type already exists
 *   → { alreadyAvailable: true } when REPORT is requested but the report is
 *     already client-visible (UI scrolls to the report section instead)
 *   → { ok: true, taskId } otherwise (admins notified with a job deep link)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
        const portal = await requireClientPortal({ permission: "bookings" });
    if (!isClientModuleEnabled(portal.visibility, "jobs")) {
      return NextResponse.json({ error: "Jobs are hidden for this client." }, { status: 403 });
    }

    const body = createSchema.parse(await req.json().catch(() => ({})));
    const job = await loadScopedJob(params.id, portal);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    // Report short-circuit: nothing to request if it is already published.
    if (body.type === "REPORT" && job.report?.clientVisible === true) {
      return NextResponse.json({ alreadyAvailable: true });
    }

    const tasks = await loadClientRequestTasks(params.id, portal.clientId);
    if (hasOpenRequestOfType(tasks, body.type)) {
      return NextResponse.json(
        { error: "You already have an open request of this type — we'll be in touch shortly." },
        { status: 409 }
      );
    }

    const created = await createClientLightRequest({
      jobId: params.id,
      clientId: portal.clientId,
      requestedByUserId: portal.userId,
      requestType: body.type,
      note: body.note ?? null,
      baseUrl: req,
    });

    return NextResponse.json({ ok: true, taskId: created.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not send request." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
