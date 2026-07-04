/**
 * Template store — server-side persistence helpers for the editor
 * (rebrand doc 03 §1.6 rules):
 *   1. Publish is append-only: editing creates/updates a DRAFT version;
 *      publishing flips TemplateDefinition.publishedVersionId and archives the
 *      previous published version. Published docs never mutate.
 *   2. Draft PATCHes use optimistic concurrency (updatedAt token → 409).
 */

import { Prisma, TemplateVersionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { parseTemplateDoc, type TemplateDoc, emptyDoc, type TemplateKind } from "./model";
import {
  getKindConfig,
  defaultClientInvoiceIssuedEmail,
  defaultClientInvoiceDoc,
  defaultJobReminderSms,
} from "./kinds";

const SYSTEM_SCOPE = "SYSTEM";

/** Default SYSTEM doc for a kind — seed material for first-open. */
export function defaultDocForKind(kind: string): TemplateDoc {
  const doc = emptyDoc(kind as TemplateKind);
  switch (kind) {
    case "email.clientInvoiceIssued":
      return { ...doc, blocks: defaultClientInvoiceIssuedEmail() };
    case "doc.clientInvoice":
      return { ...doc, page: { ...doc.page, size: "A4" }, blocks: defaultClientInvoiceDoc() };
    case "sms.jobReminder":
      return { ...doc, blocks: defaultJobReminderSms() };
    default:
      return doc;
  }
}

export async function getOrCreateDefinition(kind: string) {
  const config = getKindConfig(kind);
  if (!config) throw new Error(`Unknown template kind: ${kind}`);

  const existing = await db.templateDefinition.findUnique({
    where: { kind_scope: { kind, scope: SYSTEM_SCOPE } },
  });
  if (existing) return existing;

  return db.templateDefinition.create({
    data: {
      kind,
      scope: SYSTEM_SCOPE,
      name: config.label,
      versions: {
        create: {
          version: 1,
          doc: defaultDocForKind(kind) as unknown as Prisma.InputJsonValue,
          status: TemplateVersionStatus.DRAFT,
        },
      },
    },
  });
}

/**
 * Latest DRAFT for a definition; if none exists (everything published /
 * archived), clone the published doc into a new DRAFT with the next version.
 */
export async function getOrCreateDraft(definitionId: string) {
  const draft = await db.templateVersion.findFirst({
    where: { definitionId, status: TemplateVersionStatus.DRAFT },
    orderBy: { version: "desc" },
  });
  if (draft) return draft;

  const definition = await db.templateDefinition.findUnique({
    where: { id: definitionId },
    include: { publishedVersion: true },
  });
  if (!definition) throw new Error("Definition not found");

  const latest = await db.templateVersion.findFirst({
    where: { definitionId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const baseDoc =
    (definition.publishedVersion?.doc as unknown as TemplateDoc | undefined) ??
    defaultDocForKind(definition.kind);

  return db.templateVersion.create({
    data: {
      definitionId,
      version: (latest?.version ?? 0) + 1,
      doc: baseDoc as unknown as Prisma.InputJsonValue,
      status: TemplateVersionStatus.DRAFT,
    },
  });
}

export class DraftConflictError extends Error {
  constructor() {
    super("Draft was modified elsewhere");
    this.name = "DraftConflictError";
  }
}

/**
 * Save a draft doc. `expectedToken` = the updatedAt ISO the client last saw;
 * mismatch throws DraftConflictError (→ 409). Returns the new token.
 */
export async function saveDraft(
  draftId: string,
  rawDoc: unknown,
  expectedToken: string,
): Promise<{ token: string }> {
  const doc = parseTemplateDoc(rawDoc); // zod-validate before storing

  const result = await db.templateVersion.updateMany({
    where: {
      id: draftId,
      status: TemplateVersionStatus.DRAFT,
      updatedAt: new Date(expectedToken),
    },
    data: { doc: doc as unknown as Prisma.InputJsonValue },
  });
  if (result.count === 0) throw new DraftConflictError();

  const fresh = await db.templateVersion.findUnique({
    where: { id: draftId },
    select: { updatedAt: true },
  });
  return { token: fresh!.updatedAt.toISOString() };
}

/**
 * Publish a draft: archive the currently-published version, mark the draft
 * PUBLISHED, flip the definition pointer. Lint must pass BEFORE calling this.
 */
export async function publishDraft(definitionId: string, draftId: string, userId?: string) {
  return db.$transaction(async (tx) => {
    const definition = await tx.templateDefinition.findUnique({ where: { id: definitionId } });
    if (!definition) throw new Error("Definition not found");
    const draft = await tx.templateVersion.findFirst({
      where: { id: draftId, definitionId, status: TemplateVersionStatus.DRAFT },
    });
    if (!draft) throw new Error("Draft not found");

    if (definition.publishedVersionId && definition.publishedVersionId !== draftId) {
      await tx.templateVersion.update({
        where: { id: definition.publishedVersionId },
        data: { status: TemplateVersionStatus.ARCHIVED },
      });
    }
    const published = await tx.templateVersion.update({
      where: { id: draftId },
      data: {
        status: TemplateVersionStatus.PUBLISHED,
        publishedAt: new Date(),
        createdById: userId ?? draft.createdById,
      },
    });
    await tx.templateDefinition.update({
      where: { id: definitionId },
      data: { publishedVersionId: draftId },
    });
    return published;
  });
}

/**
 * The currently-published doc for a kind (SYSTEM scope), or null if the kind
 * has no published version. Render paths call this behind the per-kind flag.
 */
export async function getPublishedDoc(kind: string): Promise<{ doc: TemplateDoc; versionId: string } | null> {
  const definition = await db.templateDefinition.findUnique({
    where: { kind_scope: { kind, scope: SYSTEM_SCOPE } },
    include: { publishedVersion: true },
  });
  if (!definition?.publishedVersion) return null;
  const doc = parseTemplateDoc(definition.publishedVersion.doc);
  return { doc, versionId: definition.publishedVersion.id };
}

/**
 * Freeze an issued artifact (rebrand doc 03 §1.6 rule 2). Re-viewing renders
 * from this snapshot, never the live template — so template edits never change
 * issued paper. Best-effort: a snapshot failure must not block the artifact.
 */
export async function snapshotRenderedDocument(params: {
  kind: string;
  entityType: string;
  entityId: string;
  templateVersionId: string | null;
  doc: TemplateDoc;
  data: unknown;
  htmlKey?: string;
  pdfKey?: string;
}): Promise<void> {
  try {
    await db.renderedDocument.create({
      data: {
        kind: params.kind,
        entityType: params.entityType,
        entityId: params.entityId,
        templateVersionId: params.templateVersionId,
        docSnapshot: params.doc as unknown as Prisma.InputJsonValue,
        dataSnapshot: params.data as unknown as Prisma.InputJsonValue,
        htmlKey: params.htmlKey,
        pdfKey: params.pdfKey,
      },
    });
  } catch {
    // Snapshot is a durability nicety, not a correctness gate for the send.
  }
}

export async function listVersions(definitionId: string) {
  return db.templateVersion.findMany({
    where: { definitionId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      status: true,
      label: true,
      createdAt: true,
      publishedAt: true,
    },
  });
}
