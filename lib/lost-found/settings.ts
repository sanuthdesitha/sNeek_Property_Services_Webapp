/**
 * Lost and found settings: the holding period (default 14 days, owner
 * decision 2026-11-11) and, since 2026-11-20, the guest return requests:
 * whether the public link is offered, how long it works, how many upcoming
 * cleans are offered as pickup times, the post and drop-off fee wording, the
 * acknowledgement message and whether clients may approve fully.
 *
 * Stored as one AppSetting row, like the urgent stock reminder settings;
 * changing it is administrator-only and audited. A save merges into what is
 * stored, so a caller that sends only `holdingDays` changes nothing else.
 */
import { Role, type Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_HOLDING_DAYS, MAX_HOLDING_DAYS } from "./holding";
import { DEFAULT_ACK_BODY, DEFAULT_ACK_SUBJECT } from "./return-rules";

export const LOST_FOUND_SETTINGS_KEY = "lost_found_v1:settings";

export const MAX_LINK_DAYS = 90;
export const MAX_UPCOMING_CLEANS = 10;
export const DEFAULT_UPCOMING_CLEANS = 3;
/** When the holding period is already over (or none applies): the link works this long. */
export const FALLBACK_LINK_DAYS = 30;

const feeSchema = z.object({
  text: z.string().trim().max(200).nullable(),
  /** Whole cents; null = no amount configured (never 0 by default). */
  cents: z.number().int().min(0).max(10_000_000).nullable(),
}).strict();

const acknowledgementSchema = z.object({
  enabled: z.boolean(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(1000),
}).strict();

export const lostFoundSettingsSchema = z.object({
  holdingDays: z.number().int().min(1).max(MAX_HOLDING_DAYS),
  publicReturnRequests: z.boolean().default(true),
  /** Null: until the holding period ends (or FALLBACK_LINK_DAYS when it has). */
  linkDays: z.number().int().min(1).max(MAX_LINK_DAYS).nullable().default(null),
  upcomingCleans: z.number().int().min(1).max(MAX_UPCOMING_CLEANS).default(DEFAULT_UPCOMING_CLEANS),
  postFee: feeSchema.default({ text: null, cents: null }),
  dropOffFee: feeSchema.default({ text: null, cents: null }),
  acknowledgement: acknowledgementSchema.default({ enabled: true, subject: DEFAULT_ACK_SUBJECT, body: DEFAULT_ACK_BODY }),
  clientsCanApproveReturns: z.boolean().default(false),
}).strict();

export type LostFoundSettings = z.infer<typeof lostFoundSettingsSchema>;
export type LostFoundFeeSetting = z.infer<typeof feeSchema>;

export const DEFAULT_LOST_FOUND_SETTINGS: LostFoundSettings = lostFoundSettingsSchema.parse({ holdingDays: DEFAULT_HOLDING_DAYS });

/** A stored value that no longer parses falls back to the default, never to 0. */
export async function readLostFoundSettings(): Promise<LostFoundSettings> {
  const row = await db.appSetting.findUnique({ where: { key: LOST_FOUND_SETTINGS_KEY } });
  const parsed = lostFoundSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_LOST_FOUND_SETTINGS;
}

/** The fields a save may carry; anything left out keeps its stored value. */
const settingsPatchSchema = z.object({
  holdingDays: z.number().int().min(1).max(MAX_HOLDING_DAYS).optional(),
  publicReturnRequests: z.boolean().optional(),
  linkDays: z.number().int().min(1).max(MAX_LINK_DAYS).nullable().optional(),
  upcomingCleans: z.number().int().min(1).max(MAX_UPCOMING_CLEANS).optional(),
  postFee: feeSchema.optional(),
  dropOffFee: feeSchema.optional(),
  acknowledgement: acknowledgementSchema.optional(),
  clientsCanApproveReturns: z.boolean().optional(),
}).strict();

export async function saveLostFoundSettings(actor: { id: string; role: Role }, raw: unknown): Promise<LostFoundSettings> {
  if (actor.role !== Role.ADMIN) throw new Error("FORBIDDEN");
  const patch = settingsPatchSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOST_FOUND_SETTINGS_KEY}))`;
    const before = await tx.appSetting.findUnique({ where: { key: LOST_FOUND_SETTINGS_KEY } });
    const current = lostFoundSettingsSchema.safeParse(before?.value);
    const settings = lostFoundSettingsSchema.parse({ ...(current.success ? current.data : DEFAULT_LOST_FOUND_SETTINGS), ...patch });
    const value = settings as unknown as Prisma.InputJsonValue;
    await tx.appSetting.upsert({ where: { key: LOST_FOUND_SETTINGS_KEY }, create: { key: LOST_FOUND_SETTINGS_KEY, value }, update: { value } });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "LOST_FOUND_SETTINGS_UPDATED",
        entity: "AppSetting",
        entityId: LOST_FOUND_SETTINGS_KEY,
        ...(before ? { before: before.value as Prisma.InputJsonValue } : {}),
        after: value,
      },
    });
    return settings;
  });
}
