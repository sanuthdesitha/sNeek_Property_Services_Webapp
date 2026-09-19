import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { notifyAdminsByEmail, notifyAdminsByPush } from "@/lib/notifications/admin-alerts";
import { clientMessageContext, saveClientMessage, ClientMessageError } from "@/lib/client/message-receipt";
import { escapeHtml } from "@/lib/utils/escape-html";

const schema = z.object({
  body: z.string().trim().min(1).max(4000),
  // Optional per-job thread — null/omitted = the client's global thread.
  jobId: z.string().cuid().optional().nullable(),
  requestId: z.string().uuid().optional(),
});

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(req: NextRequest) {
  try {
    // One chokepoint: role check, client resolution and the "messages" grant.
    // A VA posts under their own user id, so the thread shows who really wrote.
    const portal = await requireClientPortal({ permission: "messages" });

    // ?jobId= scopes to that job's thread; absent = every message (global page
    // shows job-thread rows with a job chip).
    const jobId = req.nextUrl.searchParams.get("jobId")?.trim() || null;

    // ClientMessage.jobId is a scalar, so resolve the authorized job set first.
    // Global messages remain available under the existing messages grant.
    const jobs = await db.job.findMany({
      where: { ...(jobId ? { id: jobId } : {}), property: propertyScopeWhere(portal) },
      select: { id: true, jobNumber: true, property: { select: { name: true } } },
    });
    if (jobId && jobs.length === 0) {
      return NextResponse.json({ error: "Job not found." }, { status: 404, headers: privateHeaders });
    }
    const messageScope = {
      clientId: portal.clientId,
      ...(jobId ? { jobId } : { OR: [{ jobId: null }, { jobId: { in: jobs.map((job) => job.id) } }] }),
    };
    const withContext = req.nextUrl.searchParams.get("withContext") === "1";
    const fetched = await db.clientMessage.findMany({
      where: messageScope,
      include: {
        sentBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: withContext ? [{ createdAt: "desc" }, { id: "desc" }] : { createdAt: "asc" },
      take: withContext ? 501 : 500,
    });
    const rows = withContext ? fetched.slice(0, 500).reverse() : fetched;

    const readIds = rows.filter((row) => row.isFromAdmin && !row.isRead).map((row) => row.id);
    if (readIds.length > 0) await db.clientMessage.updateMany({
      where: {
        clientId: portal.clientId,
        id: { in: readIds },
        isFromAdmin: true,
        isRead: false,
      },
      data: { isRead: true },
    });

    const jobChips = Object.fromEntries(jobs.map((job) => [job.id, {
      id: job.id, jobNumber: job.jobNumber, propertyName: job.property?.name ?? null,
    }]));
    return NextResponse.json(
      rows.map((row) => ({ ...row, job: row.jobId ? jobChips[row.jobId] ?? null : null })),
      { headers: { ...privateHeaders, ...(withContext ? { "X-Client-Message-Context": (await clientMessageContext(portal, jobId)).context, "X-Client-Message-History-Limited": String(fetched.length > 500) } : {}) } }
    );
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: status === 400 ? "Could not load messages." : error.message }, { status, headers: privateHeaders });
  }
}

export async function POST(req: NextRequest) {
  try {
    const portal = await requireClientPortal({ permission: "messages" });
    const body = schema.parse(await req.json().catch(() => ({})));
    const { message, client, job, duplicated } = await saveClientMessage({ portal, body: body.body, jobId: body.jobId ?? null, requestId: body.requestId, context: req.headers.get("X-Client-Message-Context") });
    let deliveryWarning: string | undefined = duplicated ? "Message already saved. Earlier office notification delivery status is unavailable; notifications were not sent again." : undefined;
    if (!duplicated) {
      const jobLabel = job ? ` about job${job.jobNumber ? ` #${job.jobNumber}` : ""}${job.property?.name ? ` (${job.property.name})` : ""}` : "";
      const delivery = await Promise.allSettled([
        Promise.resolve().then(() => notifyAdminsByPush({ jobId: job?.id, subject: "New client message", body: `${client.name} sent a new message${jobLabel} in the client portal.` })),
        Promise.resolve().then(() => notifyAdminsByEmail({ subject: `New client message from ${client.name}`, html: `<p><strong>${escapeHtml(client.name)}</strong> sent a new portal message${escapeHtml(jobLabel)}.</p><p>${escapeHtml(body.body)}</p>` })),
      ]);
      const emailResult = delivery[1];
      if (delivery.some(result => result.status === "rejected") || (emailResult.status === "fulfilled" && typeof emailResult.value === "object" && emailResult.value !== null && "ok" in emailResult.value && emailResult.value.ok === false)) deliveryWarning = "Message saved. Office notification delivery could not be fully confirmed.";
    }
    return NextResponse.json({ ...message, job: job ? { id: job.id, jobNumber: job.jobNumber, propertyName: job.property?.name ?? null } : null,
      ...(body.requestId ? { requestId: body.requestId, duplicated } : {}), ...(deliveryWarning ? { deliveryWarning } : {}) }, { status: duplicated ? 200 : 201, headers: { ...privateHeaders, ...(body.requestId ? { "X-Client-Message-Context": req.headers.get("X-Client-Message-Context")! } : {}) } });
  } catch (error: any) {
    const status = error instanceof ClientMessageError ? error.status : error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not send message." }, { status, headers: privateHeaders });
  }
}
