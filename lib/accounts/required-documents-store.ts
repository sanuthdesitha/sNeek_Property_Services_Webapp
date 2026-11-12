/**
 * Stored setting for required documents per role: one AppSetting row, like the
 * lost and found settings. Reading falls back to the EMPTY default (nothing
 * required) when missing or unreadable — never to an invented list. Changing
 * it is administrator-only and audited.
 */
import "server-only";
import { Role, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { EMPTY_REQUIRED_DOCUMENTS, requiredDocumentsSchema, type RequiredDocumentsSetting } from "./required-documents";

export const REQUIRED_DOCUMENTS_SETTINGS_KEY = "staff_required_documents_v1";

export type RequiredDocumentsRead = RequiredDocumentsSetting & {
  /** False when a stored value could not be read (the screen says so instead of showing "nothing required"). */
  readable: boolean;
};

export async function readRequiredDocuments(): Promise<RequiredDocumentsRead> {
  const row = await db.appSetting.findUnique({ where: { key: REQUIRED_DOCUMENTS_SETTINGS_KEY } });
  if (!row) return { ...EMPTY_REQUIRED_DOCUMENTS, readable: true };
  const parsed = requiredDocumentsSchema.safeParse(row.value);
  return parsed.success ? { ...parsed.data, readable: true } : { ...EMPTY_REQUIRED_DOCUMENTS, readable: false };
}

export async function saveRequiredDocuments(actor: { id: string; role: Role }, raw: unknown): Promise<RequiredDocumentsSetting> {
  if (actor.role !== Role.ADMIN) throw new Error("FORBIDDEN");
  const parsed = requiredDocumentsSchema.parse(raw);
  const cleaned: RequiredDocumentsSetting = {
    byRole: Object.fromEntries(
      Object.entries(parsed.byRole)
        .map(([role, categories]) => [role, Array.from(new Set(categories))] as const)
        .filter(([, categories]) => categories.length > 0),
    ),
  };
  const value = cleaned as unknown as Prisma.InputJsonValue;
  return db.$transaction(async (tx) => {
    const before = await tx.appSetting.findUnique({ where: { key: REQUIRED_DOCUMENTS_SETTINGS_KEY } });
    await tx.appSetting.upsert({ where: { key: REQUIRED_DOCUMENTS_SETTINGS_KEY }, create: { key: REQUIRED_DOCUMENTS_SETTINGS_KEY, value }, update: { value } });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "REQUIRED_DOCUMENTS_UPDATED",
        entity: "AppSetting",
        entityId: REQUIRED_DOCUMENTS_SETTINGS_KEY,
        ...(before ? { before: before.value as Prisma.InputJsonValue } : {}),
        after: value,
      },
    });
    return cleaned;
  });
}
