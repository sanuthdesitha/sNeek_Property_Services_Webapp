import "server-only";
/**
 * Draft versions of form templates.
 *
 * A template has at most one DRAFT FormTemplateVersion row: its working copy.
 * Saving a draft NEVER touches FormTemplate.schema, so it never changes what a
 * job resolves to or what a cleaner fills in (lib/forms/resolve-job-template.ts
 * and resolve-effective-job-form.ts read FormTemplate only). Publishing
 * (template-publish.ts) is the only step that copies a draft to the live row.
 *
 * Concurrency: every save may carry the "edit token" the editor loaded — the
 * draft's updatedAt when a draft exists, otherwise the template's updatedAt.
 * A save from an editor whose token is no longer current is refused (409), the
 * same guarantee the builder's direct save had (lib/forms/template-concurrency).
 */
import { FormTemplateVersionKind, Prisma, type JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { formTemplateSchemaZ, validateFormSchemaForSave } from "./template-schema";
import { isStaleTemplateWrite } from "./template-concurrency";
import { staleTemplateError, TemplateServiceError } from "./template-errors";

type Tx = Prisma.TransactionClient;

export type TemplateDraft = {
  id: string;
  /** The live version this draft was started from. */
  baseVersion: number;
  schema: unknown;
  name: string | null;
  serviceType: JobType | null;
  note: string | null;
  restoredFromVersionId: string | null;
  updatedAt: Date;
};

export type SaveDraftInput = {
  templateId: string;
  schema: unknown;
  name?: string;
  serviceType?: JobType;
  note?: string | null;
  restoredFromVersionId?: string | null;
  actorId: string;
  /** Edit token the editor loaded; omitted by callers that hold no editor state. */
  expectedToken?: string;
  /**
   * Run the strict save check (validateFormSchemaForSave). On by default.
   * Restoring an old published version turns it off: history is copied back
   * exactly as it was published, and the checks then block publishing it
   * until whatever newer rules it breaks are fixed.
   */
  strict?: boolean;
};

const DRAFT_SELECT = {
  id: true,
  version: true,
  schema: true,
  name: true,
  serviceType: true,
  note: true,
  restoredFromVersionId: true,
  updatedAt: true,
} satisfies Prisma.FormTemplateVersionSelect;

type DraftRow = Prisma.FormTemplateVersionGetPayload<{ select: typeof DRAFT_SELECT }>;

function toDraft(row: DraftRow): TemplateDraft {
  return {
    id: row.id,
    baseVersion: row.version,
    schema: row.schema,
    name: row.name,
    serviceType: row.serviceType,
    note: row.note,
    restoredFromVersionId: row.restoredFromVersionId,
    updatedAt: row.updatedAt,
  };
}

async function draftRows(client: Tx | typeof db, templateId: string): Promise<DraftRow[]> {
  return client.formTemplateVersion.findMany({
    where: { templateId, kind: FormTemplateVersionKind.DRAFT },
    orderBy: { updatedAt: "desc" },
    select: DRAFT_SELECT,
  });
}

export async function readTemplateDraft(templateId: string, client: Tx | typeof db = db): Promise<TemplateDraft | null> {
  const [row] = await draftRows(client, templateId);
  return row ? toDraft(row) : null;
}

/** The token an editor must send back on its next save. */
export function templateEditToken(templateUpdatedAt: Date, draft: { updatedAt: Date } | null): string {
  return (draft?.updatedAt ?? templateUpdatedAt).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function writeDraft(tx: Tx, input: SaveDraftInput): Promise<{ draft: TemplateDraft; token: string }> {
  const template = await tx.formTemplate.findUnique({
    where: { id: input.templateId },
    select: { id: true, version: true, updatedAt: true },
  });
  if (!template) throw new TemplateServiceError("NOT_FOUND", "Form template not found.");
  const [current, ...extra] = await draftRows(tx, input.templateId);
  const token = templateEditToken(template.updatedAt, current ?? null);
  if (isStaleTemplateWrite(new Date(token), input.expectedToken)) throw staleTemplateError(token);

  const data = {
    version: template.version,
    schema: input.schema as Prisma.InputJsonValue,
    name: input.name ?? current?.name ?? null,
    serviceType: input.serviceType ?? current?.serviceType ?? null,
    note: input.note === undefined ? current?.note ?? null : input.note,
    restoredFromVersionId:
      input.restoredFromVersionId === undefined ? current?.restoredFromVersionId ?? null : input.restoredFromVersionId,
    createdById: input.actorId,
  };
  let saved: DraftRow;
  if (current) {
    // Conditional on the row we read, so two saves racing from the same base
    // cannot both succeed: the loser is told the draft moved.
    const result = await tx.formTemplateVersion.updateMany({
      where: { id: current.id, updatedAt: current.updatedAt },
      data,
    });
    if (result.count !== 1) throw staleTemplateError(token);
    saved = await tx.formTemplateVersion.findUniqueOrThrow({ where: { id: current.id }, select: DRAFT_SELECT });
    if (extra.length > 0) {
      await tx.formTemplateVersion.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
    }
  } else {
    saved = await tx.formTemplateVersion.create({
      data: { templateId: input.templateId, kind: FormTemplateVersionKind.DRAFT, ...data },
      select: DRAFT_SELECT,
    });
  }
  return { draft: toDraft(saved), token: saved.updatedAt.toISOString() };
}

/** Create or replace the template's draft. The live template is not touched. */
export async function saveTemplateDraft(
  input: SaveDraftInput,
  tx?: Tx,
): Promise<{ draft: TemplateDraft; token: string }> {
  const parsed = formTemplateSchemaZ.safeParse(input.schema);
  if (!parsed.success) {
    throw new TemplateServiceError("INVALID_SCHEMA", parsed.error.issues[0]?.message ?? "The form structure is invalid.");
  }
  if (input.strict !== false) {
    const strict = validateFormSchemaForSave(input.schema);
    if (!strict.ok) {
      throw new TemplateServiceError(
        "INVALID_SCHEMA",
        `The draft was not saved: ${strict.issues[0]?.message ?? "the form structure is invalid."}${strict.issues.length > 1 ? ` (and ${strict.issues.length - 1} more)` : ""}`,
        undefined,
        strict.issues,
      );
    }
  }
  const run = (client: Tx) => writeDraft(client, { ...input, schema: parsed.data });
  try {
    return tx ? await run(tx) : await db.$transaction(run);
  } catch (error) {
    // Two first saves raced to create the draft; the unique key refused one.
    if (isUniqueViolation(error)) throw staleTemplateError(new Date().toISOString());
    throw error;
  }
}

/**
 * Restore an earlier PUBLISHED version by making it the draft. History is
 * never rewritten: the old row stays, and publishing the draft writes a new
 * version. An existing draft is only replaced when the caller says so.
 */
export async function restoreTemplateVersion(input: {
  templateId: string;
  versionId: string;
  actorId: string;
  replaceDraft: boolean;
}): Promise<{ draft: TemplateDraft; token: string }> {
  return db.$transaction(async (tx) => {
    const source = await tx.formTemplateVersion.findFirst({
      where: { id: input.versionId, templateId: input.templateId, kind: FormTemplateVersionKind.PUBLISHED },
      select: { id: true, version: true, schema: true, name: true, serviceType: true },
    });
    if (!source) throw new TemplateServiceError("NOT_FOUND", "That version does not belong to this form.");
    const existing = await readTemplateDraft(input.templateId, tx);
    if (existing && !input.replaceDraft) {
      throw new TemplateServiceError(
        "DRAFT_EXISTS",
        "This form already has unpublished changes. Publish or discard them, or confirm that restoring should replace them.",
      );
    }
    return saveTemplateDraft(
      {
        templateId: input.templateId,
        schema: source.schema,
        name: source.name ?? undefined,
        serviceType: source.serviceType ?? undefined,
        note: `Restored from v${source.version}`,
        restoredFromVersionId: source.id,
        actorId: input.actorId,
        strict: false,
      },
      tx,
    );
  });
}

export async function discardTemplateDraft(templateId: string): Promise<number> {
  const result = await db.formTemplateVersion.deleteMany({ where: { templateId, kind: FormTemplateVersionKind.DRAFT } });
  return result.count;
}
