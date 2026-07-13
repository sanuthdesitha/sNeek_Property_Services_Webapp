import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  previewLifecycleEmail,
  sendLifecycleEmail,
  LIFECYCLE_STAGES,
  type LifecycleStage,
  type LifecycleExtra,
} from "@/lib/notifications/lifecycle";

export const dynamic = "force-dynamic";

type Body = {
  jobId?: string;
  stage?: string;
  mode?: "preview" | "send";
  extra?: LifecycleExtra;
};

function isStage(value: unknown): value is LifecycleStage {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LIFECYCLE_STAGES, value);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const body = (await req.json().catch(() => ({}))) as Body;
    const { jobId, mode, extra } = body;

    if (!isStage(body.stage)) {
      return NextResponse.json({ error: "Unknown lifecycle stage." }, { status: 400 });
    }
    const stage = body.stage;

    if (mode !== "preview" && mode !== "send") {
      return NextResponse.json({ error: "mode must be 'preview' or 'send'." }, { status: 400 });
    }

    // If a job is supplied, it must belong to this client.
    if (jobId) {
      const job = await db.job.findUnique({
        where: { id: jobId },
        select: { property: { select: { clientId: true } } },
      });
      if (!job) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }
      if (job.property?.clientId !== params.id) {
        return NextResponse.json({ error: "This job does not belong to this client." }, { status: 400 });
      }
    }

    if (mode === "preview") {
      const preview = await previewLifecycleEmail({
        clientId: params.id,
        jobId: jobId ?? null,
        stage,
        extra,
      });
      return NextResponse.json(preview);
    }

    // mode === "send" — manual hub send always delivers, surfaces failures.
    try {
      const result = await sendLifecycleEmail({
        clientId: params.id,
        jobId: jobId ?? null,
        stage,
        mode: "manual",
        extra,
      });
      if (!result.sent) {
        const reason =
          result.skipped === "no-recipients" || result.skipped === "no-client"
            ? "No client email on file to send to."
            : result.skipped
              ? `Could not send (${result.skipped}).`
              : "The email could not be sent.";
        return NextResponse.json({ error: reason }, { status: 400 });
      }
      return NextResponse.json({ ok: true, recipients: result.recipients });
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message ?? "The email could not be sent." },
        { status: 400 },
      );
    }
  } catch (err: any) {
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not process the request." }, { status });
  }
}
