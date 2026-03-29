import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { createClientJobTaskRequest, listClientJobTasks } from "@/lib/job-tasks/service";
import { isClientModuleEnabled } from "@/lib/portal-access";

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional().nullable(),
  requiresPhoto: z.boolean().optional(),
  requiresNote: z.boolean().optional(),
  attachmentKeys: z.array(z.string().trim().min(1)).max(10).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    const portal = await getClientPortalContext(session.user.id, settings);
    if (!portal.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    if (!isClientModuleEnabled(portal.visibility, "jobs")) {
      return NextResponse.json({ error: "Jobs are hidden for this client." }, { status: 403 });
    }
    const tasks = await listClientJobTasks(params.id, portal.clientId);
    return NextResponse.json(tasks);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load task requests." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    const portal = await getClientPortalContext(session.user.id, settings);
    if (!portal.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    if (!isClientModuleEnabled(portal.visibility, "jobs")) {
      return NextResponse.json({ error: "Jobs are hidden for this client." }, { status: 403 });
    }
    if (!portal.visibility.showClientTaskRequests) {
      return NextResponse.json({ error: "Client task requests are disabled." }, { status: 403 });
    }
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const created = await createClientJobTaskRequest({
      jobId: params.id,
      clientId: portal.clientId,
      requestedByUserId: session.user.id,
      title: body.title,
      description: body.description ?? null,
      requiresPhoto: body.requiresPhoto === true,
      requiresNote: body.requiresNote === true,
      attachmentKeys: body.attachmentKeys ?? [],
      baseUrl: req,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not create task request." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
