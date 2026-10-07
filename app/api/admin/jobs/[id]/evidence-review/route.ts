import { currentEvidenceRevisions } from "@/lib/cleaner/evidence-review-contract";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSharedCleanerJobDraft, withSharedCleanerJobDraftLock } from "@/lib/cleaner/shared-job-draft";
import { draftEvidenceEntry, evidenceReviewRows } from "@/lib/cleaner/evidence-review";
import { evidenceEntryVersion, saveDraftReferenceDiscard } from "@/lib/cleaner/evidence-review-service";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
import { publicUrl } from "@/lib/s3";

const locked = new Set(["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"]);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return json({ error: message }, message === "UNAUTHORIZED" ? 401 : 403);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "Choose a draft reference and explain the resolution (10–1000 characters)." }, 400);
  return json({ error: "Draft evidence review could not be completed. Refresh and retry." }, 500);
}
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const job = await db.job.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
    if (!job) return json({ error: "Job not found." }, 404);
    const draft = await getSharedCleanerJobDraft(params.id);
    const entries = evidenceReviewRows(draft, params.id);
    let revisions: Record<string, string> = {}, comparisonWarning: string | null = null;
    try { revisions = await currentEvidenceRevisions(params.id, Array.from(new Set(entries.flatMap(row => row.source ? [row.source.userId] : [])))); }
    catch { comparisonWarning = "The current form could not be compared. Original capture records are shown unchanged; review their provenance before discarding a reference."; }
    const rows = entries.map(row => {
      const expectedIdentity = row.source ? cleanerDraftIdentity({ user: { id: row.source.userId } }, params.id) : null;
      const issues = [...row.issues];
      if (row.source && revisions[row.source.userId] && row.receipts.some(([, receipt]) => !receipt.detached && receipt.formRevision !== revisions[row.source!.userId])) issues.push("Captured under an older or different form version");
      if (expectedIdentity && row.receipts.some(([, receipt]) => !receipt.detached && receipt.draftIdentity !== expectedIdentity)) issues.push("Different capture account context");
      return { key: row.key, name: row.name, source: row.source, issues, removed: row.removed,
        previewUrl: row.source ? publicUrl(row.key) : null,
        locations: row.locations.map(item => item.destination), receipts: row.receipts.map(([id, receipt]) => ({ id, ...receipt })),
        version: evidenceEntryVersion(draft, row.key) };
    });
    const history = await db.auditLog.findMany({ where: { jobId: params.id, entity: "CleanerDraftEvidence" }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, action: true, createdAt: true, user: { select: { name: true } }, after: true } });
    return json({ jobId: params.id, locked: locked.has(job.status), rows, history, comparisonWarning });
  } catch (error) { return failure(error); }
}
const schema = z.object({ action: z.literal("DISCARD_DRAFT_REFERENCE"), key: z.string().min(1).max(1000), version: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(1000) }).strict();
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    return await withSharedCleanerJobDraftLock(params.id, async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${params.id} FOR UPDATE`;
      const job = await tx.job.findUnique({ where: { id: params.id }, select: { status: true } });
      if (!job) return json({ error: "Job not found." }, 404);
      if (locked.has(job.status)) return json({ error: "Submitted jobs are read-only. This tool cannot change submitted evidence." }, 409);
      const draft = await getSharedCleanerJobDraft(params.id, tx);
      const entry = draftEvidenceEntry(draft, body.key);
      if (!entry.locations.length && !entry.receipts.length) return json({ error: "This reference is no longer in the saved draft. Refresh before reviewing." }, 409);
      if (!entry.locations.length && entry.receipts.length && entry.receipts.every(([, receipt]) => receipt.detached)) return json({ ok: true, key: body.key, alreadyRemoved: true });
      if (body.version !== evidenceEntryVersion(draft, body.key)) return json({ error: "This evidence changed since review. Refresh and review the current reference before overriding." }, 409);
      await saveDraftReferenceDiscard(tx, params.id, draft, { key: body.key, reason: body.reason, actorId: session.impersonation?.actorId ?? session.user.id,
        actorName: session.user.name ?? "Office", effectiveUserId: session.user.id, formRevision: "draft-reference-removal", draftIdentity: cleanerDraftIdentity(session, params.id), office: true });
      return json({ ok: true, key: body.key, discardedReference: true });
    });
  } catch (error) { return failure(error); }
}
