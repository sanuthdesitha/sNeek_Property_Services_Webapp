import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_SOCIAL_TEMPLATES, SOCIAL_TEMPLATES_KEY, socialTemplatesSchema, type SocialTemplates } from "./captions";

/**
 * Caption templates, hashtag sets and brand frames (AppSetting
 * `social_templates_v1`). Missing reads the defaults; an unreadable row also
 * reads the defaults but says so (`readable: false`) so a save never
 * overwrites it unnoticed. Saves are revisioned under a lock and audited.
 */

export async function getSocialTemplates(): Promise<{ templates: SocialTemplates; readable: boolean }> {
  const row = await db.appSetting.findUnique({ where: { key: SOCIAL_TEMPLATES_KEY } });
  if (!row) return { templates: DEFAULT_SOCIAL_TEMPLATES, readable: true };
  const parsed = socialTemplatesSchema.safeParse(row.value);
  return parsed.success ? { templates: parsed.data, readable: true } : { templates: DEFAULT_SOCIAL_TEMPLATES, readable: false };
}

export class TemplatesConflictError extends Error {
  constructor(public current: SocialTemplates) {
    super("Someone saved the templates since you opened them.");
    this.name = "TemplatesConflictError";
  }
}

export async function saveSocialTemplates(input: { expectedRevision: number; templates: Omit<SocialTemplates, "revision">; actorId: string }): Promise<SocialTemplates> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SOCIAL_TEMPLATES_KEY}))`;
    const row = await tx.appSetting.findUnique({ where: { key: SOCIAL_TEMPLATES_KEY } });
    const parsed = row ? socialTemplatesSchema.safeParse(row.value) : null;
    const current = parsed?.success ? parsed.data : DEFAULT_SOCIAL_TEMPLATES;
    if (current.revision !== input.expectedRevision) throw new TemplatesConflictError(current);
    const next = socialTemplatesSchema.parse({ ...input.templates, version: 1, revision: current.revision + 1 });
    await tx.appSetting.upsert({ where: { key: SOCIAL_TEMPLATES_KEY }, create: { key: SOCIAL_TEMPLATES_KEY, value: next as unknown as Prisma.InputJsonValue }, update: { value: next as unknown as Prisma.InputJsonValue } });
    await tx.auditLog.create({ data: { userId: input.actorId, action: "SOCIAL_TEMPLATES_UPDATED", entity: "AppSetting", entityId: SOCIAL_TEMPLATES_KEY, before: current as unknown as Prisma.InputJsonValue, after: next as unknown as Prisma.InputJsonValue } });
    return next;
  });
}
