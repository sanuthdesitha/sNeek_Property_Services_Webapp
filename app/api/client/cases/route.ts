import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findJobInScope, propertyIdInScope, propertyScopeWhere, requireClientPortal, auditClientPortalAction } from "@/lib/auth/client-portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { db } from "@/lib/db";
import { createCase, listCases, toClientCaseView } from "@/lib/cases/service";
import { notifyCaseCreated } from "@/lib/cases/notifications";

const querySchema = z.object({
  status: z.string().trim().optional(),
});

/** Shown to office staff as a link, so only a web address or an app path is accepted. */
const safeAttachmentUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => /^https:\/\//i.test(value) || (value.startsWith("/") && !value.startsWith("//")), "Invalid attachment link.")
  .optional()
  .nullable();

const createSchema = z.object({
  propertyId: z.string().trim().optional().nullable(),
  jobId: z.string().trim().optional().nullable(),
  reportId: z.string().trim().optional().nullable(),
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(6000),
  caseType: z.enum(["DAMAGE", "CLIENT_DISPUTE", "LOST_FOUND", "OTHER"]).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  attachments: z.array(
    z.object({
      s3Key: z.string().trim().min(1),
      url: safeAttachmentUrl,
      mimeType: z.string().trim().optional().nullable(),
      label: z.string().trim().optional().nullable(),
    })
  ).max(3).optional(),
});

export async function GET(req: NextRequest) {
  try {
    // Chokepoint: role, client resolution and the "maintenance" grant (raising
    // and tracking issues is the granted capability cases fall under).
    const portal = await requireClientPortal({ permission: "maintenance" });
    if (!isClientModuleEnabled(portal.visibility, "cases")) {
      return NextResponse.json({ error: "Cases are hidden for this client." }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const query = querySchema.parse({
      status: searchParams.get("status") ?? undefined,
    });
    const items = await listCases({
      clientId: portal.clientId,
      status: query.status ?? null,
      clientVisibleOnly: true,
    });
    // listCases filters by client only; an assistant's property grant applies here.
    const inScope = items.filter((item) => propertyIdInScope(item.property?.id, portal));
    return NextResponse.json(inScope.map((item) => toClientCaseView(item)));
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load cases." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // Chokepoint: role, client resolution and the "maintenance" grant (raising
    // and tracking issues is the granted capability cases fall under).
    const portal = await requireClientPortal({ permission: "maintenance" });
    const body = createSchema.parse(await req.json().catch(() => ({})));

    // The ids in the body are claims, not facts: a case must not be attachable
    // to another client's property or job, and a scoped VA must stay inside
    // the properties their client granted. Same-shaped 404s, no existence oracle.
    if (body.propertyId) {
      const property = await db.property.findFirst({
        where: { ...propertyScopeWhere(portal), id: body.propertyId },
        select: { id: true },
      });
      if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }
    if (body.jobId) {
      const job = await findJobInScope(body.jobId, portal);
      if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    // A report id is a claim too: it must be a report on a job in scope.
    if (body.reportId) {
      const report = await db.report.findFirst({
        where: { id: body.reportId, job: { property: propertyScopeWhere(portal) } },
        select: { id: true },
      });
      if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
    const caseType = body.caseType ?? "CLIENT_DISPUTE";
    const title =
      body.title?.trim() ||
      (caseType === "DAMAGE"
        ? "Damage reported"
        : caseType === "LOST_FOUND"
          ? "Lost or found item"
          : caseType === "OTHER"
            ? "Service issue"
            : "Client dispute");
    const created = await createCase({
      title,
      description: body.description,
      severity: body.severity ?? "MEDIUM",
      status: "OPEN",
      caseType,
      source: "CLIENT_PORTAL",
      clientId: portal.clientId,
      propertyId: body.propertyId ?? null,
      jobId: body.jobId ?? null,
      reportId: body.reportId ?? null,
      clientVisible: true,
      clientCanReply: true,
      comment: {
        authorUserId: portal.userId,
        body: body.description,
        isInternal: false,
      },
      attachments: (body.attachments ?? []).map((attachment) => ({
        uploadedByUserId: portal.userId,
        s3Key: attachment.s3Key,
        url: attachment.url ?? null,
        mimeType: attachment.mimeType ?? null,
        label: attachment.label ?? null,
      })),
    });
    if (created) {
      await notifyCaseCreated({
        caseItem: created,
        actorLabel: portal.actorLabel,
      });
    }

    if (created) {
      await auditClientPortalAction({ ctx: portal, action: "case.create", entity: "Case", entityId: created.id });
    }
    return NextResponse.json(created ? toClientCaseView(created) : created, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not create case." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
