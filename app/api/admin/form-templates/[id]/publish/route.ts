import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { z } from "zod";
import { archiveFormTemplate, publishFormTemplate, unarchiveFormTemplate } from "@/lib/forms/template-publish";
import { templateErrorResponse } from "@/lib/forms/template-errors";

const publishSchema = z.object({
  action: z.enum(["publish", "archive", "unarchive"]),
  /** Edit token of an open builder; when present a stale publish is refused. */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

/**
 * Publish / archive / unarchive a FormTemplate. The rules live in
 * lib/forms/template-publish.ts (shared with the forms library's bulk publish):
 *
 *  - publish:   copies the template's DRAFT version (if any) to the live row as
 *               a new version, then isActive=true, publishedAt=now,
 *               archivedAt=null, and auto-archives the PRIOR active GLOBAL
 *               template of the same serviceType. Property-scoped templates
 *               and job-scoped one-offs are skipped on both sides.
 *  - archive:   isActive=false, archivedAt=now
 *  - unarchive: archivedAt=null (does NOT republish — left as draft)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const parsed = publishSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    if (parsed.data.action === "publish") {
      const result = await publishFormTemplate({
        templateId: params.id,
        actorId: session.user.id,
        expectedToken: parsed.data.expectedUpdatedAt,
      });
      return NextResponse.json(result);
    }
    const result =
      parsed.data.action === "archive" ? await archiveFormTemplate(params.id) : await unarchiveFormTemplate(params.id);
    return NextResponse.json({ ...result, archivedPrevious: 0 });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
