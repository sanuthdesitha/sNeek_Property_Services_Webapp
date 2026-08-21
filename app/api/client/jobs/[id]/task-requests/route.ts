import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
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
        const portal = await requireClientPortal({ permission: "bookings" });
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
        const portal = await requireClientPortal({ permission: "tasksCreate" });
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
      requestedByUserId: portal.userId,
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
