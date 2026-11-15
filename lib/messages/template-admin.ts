import "server-only";
/**
 * Message templates (Forms › Message templates): "Where it is used" and the
 * stale-write guarded save. A template is offered by the inbox "Insert
 * template" and Messages › Compose while it is switched on (every one, for any
 * client); client automation rules and campaigns point at it by id.
 */
import { MessageCategory, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

export const MESSAGE_TRIGGERS = ["POST_JOB", "REVIEW_REQUEST", "DISCOUNT", "NEXT_CLEAN", "MANUAL"] as const;
export const MESSAGE_CHANNELS = ["EMAIL", "SMS", "BOTH"] as const;

export const messageTemplateInput = z.object({
  name: z.string().trim().min(1).max(200),
  triggerType: z.enum(MESSAGE_TRIGGERS),
  jobType: z.string().optional().nullable(),
  channel: z.enum(MESSAGE_CHANNELS),
  category: z.nativeEnum(MessageCategory).optional(),
  subject: z.string().max(500).optional().nullable(),
  body: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const messageTemplatePatch = messageTemplateInput.partial().extend({
  /** The updatedAt the editor loaded; a different stored value is a conflict (409). */
  expectedUpdatedAt: z.string().datetime().optional(),
});

export type TemplateAutomationUse = { ruleId: string; clientId: string; clientName: string; triggerType: string; delayMinutes: number; isEnabled: boolean };
export type TemplateCampaignUse = { id: string; name: string; status: string; sentAt: string | null };
export type TemplateUsage = { automations: TemplateAutomationUse[]; campaigns: TemplateCampaignUse[] };

export async function loadTemplateUsage(templateIds?: string[]): Promise<Record<string, TemplateUsage>> {
  const where = templateIds ? { templateId: { in: templateIds } } : { templateId: { not: null } };
  const [rules, campaigns] = await Promise.all([
    db.clientAutomationRule.findMany({
      where,
      select: { id: true, templateId: true, triggerType: true, delayMinutes: true, isEnabled: true, client: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.emailCampaign.findMany({
      where,
      select: { id: true, templateId: true, name: true, status: true, sentAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const usage: Record<string, TemplateUsage> = {};
  const entry = (id: string) => (usage[id] ??= { automations: [], campaigns: [] });
  for (const rule of rules) {
    if (!rule.templateId) continue;
    entry(rule.templateId).automations.push({
      ruleId: rule.id,
      clientId: rule.client.id,
      clientName: rule.client.name,
      triggerType: rule.triggerType,
      delayMinutes: rule.delayMinutes,
      isEnabled: rule.isEnabled,
    });
  }
  for (const campaign of campaigns) {
    if (!campaign.templateId) continue;
    entry(campaign.templateId).campaigns.push({ id: campaign.id, name: campaign.name, status: campaign.status, sentAt: campaign.sentAt?.toISOString() ?? null });
  }
  return usage;
}

export class MessageTemplateConflictError extends Error {
  constructor(readonly current: unknown) {
    super("Someone else saved this template after you opened it. Your changes are kept here; reload to see theirs.");
  }
}

export class MessageTemplateNotFoundError extends Error {
  constructor() {
    super("Message template not found.");
  }
}

/** Saves a template; with `expectedUpdatedAt`, only when nobody saved it since (else 409). */
export async function updateMessageTemplate(id: string, input: z.infer<typeof messageTemplatePatch>) {
  const { expectedUpdatedAt, ...data } = input;
  if (data.channel === "SMS") data.subject = null;
  if (!expectedUpdatedAt) {
    return db.messageTemplate.update({ where: { id }, data });
  }
  return db.$transaction(async (tx) => {
    const result = await tx.messageTemplate.updateMany({ where: { id, updatedAt: new Date(expectedUpdatedAt) }, data: data as Prisma.MessageTemplateUpdateManyMutationInput });
    if (result.count === 0) {
      const current = await tx.messageTemplate.findUnique({ where: { id } });
      if (!current) throw new MessageTemplateNotFoundError();
      throw new MessageTemplateConflictError(current);
    }
    return tx.messageTemplate.findUniqueOrThrow({ where: { id } });
  });
}
