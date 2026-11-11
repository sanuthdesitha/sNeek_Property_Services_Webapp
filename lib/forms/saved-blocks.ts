import "server-only";
/**
 * Saved question blocks for the form builder ("Save as block" / "Insert saved
 * block…"). Stored without a schema change as one AppSetting row
 * (`formBuilder.savedBlocks`), because the "Checklist blocks" library holds
 * checklist MODULES (rooms, appliances) whose items carry only a few fields; a
 * saved block keeps every property of the questions it was made from.
 *
 * A block is a template for new questions: inserting it copies the questions
 * with fresh ids (lib/forms/builder-ops.ts), so a block never shares ids with
 * any form, and editing a form never changes a block.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { copyFieldsWithNewIds } from "./builder-ops";
import { TemplateServiceError } from "./template-errors";
import { validateFormSchemaForSave } from "./template-schema";
import type { FormField } from "./types";

export const SAVED_BLOCKS_KEY = "formBuilder.savedBlocks";
export const MAX_SAVED_BLOCKS = 100;
export const MAX_BLOCK_QUESTIONS = 100;

export type SavedBlock = {
  id: string;
  name: string;
  fields: FormField[];
  createdAt: string;
  createdById: string | null;
};

export type SavedBlockSummary = Omit<SavedBlock, "fields"> & { questionCount: number; fields: FormField[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Tolerant read: a malformed entry is skipped, never thrown. */
export function parseSavedBlocks(value: unknown): SavedBlock[] {
  const list = isRecord(value) && Array.isArray(value.blocks) ? value.blocks : [];
  return list.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string" || !Array.isArray(entry.fields)) return [];
    return [{
      id: entry.id,
      name: entry.name,
      fields: entry.fields.filter(isRecord) as unknown as FormField[],
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date(0).toISOString(),
      createdById: typeof entry.createdById === "string" ? entry.createdById : null,
    }];
  });
}

export async function listSavedBlocks(): Promise<SavedBlockSummary[]> {
  const row = await db.appSetting.findUnique({ where: { key: SAVED_BLOCKS_KEY }, select: { value: true } });
  return parseSavedBlocks(row?.value).map((block) => ({ ...block, questionCount: block.fields.length }));
}

type Tx = Prisma.TransactionClient;

async function writeBlocks(tx: Tx, blocks: SavedBlock[]): Promise<void> {
  const value = { blocks } as unknown as Prisma.InputJsonValue;
  await tx.appSetting.upsert({ where: { key: SAVED_BLOCKS_KEY }, create: { key: SAVED_BLOCKS_KEY, value }, update: { value } });
}

export async function createSavedBlock(input: { name: string; fields: FormField[]; actorId: string }): Promise<SavedBlock> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new TemplateServiceError("INVALID_INPUT", "Give the block a name.");
  if (input.fields.length === 0) throw new TemplateServiceError("INVALID_INPUT", "Choose at least one question.");
  if (input.fields.length > MAX_BLOCK_QUESTIONS) {
    throw new TemplateServiceError("INVALID_INPUT", `A block holds at most ${MAX_BLOCK_QUESTIONS} questions.`);
  }
  // Rules watching questions outside the block are dropped here, so a block
  // never carries a rule that points at nothing.
  const { fields } = copyFieldsWithNewIds(input.fields);
  const strict = validateFormSchemaForSave({ sections: [{ id: "block", title: name, fields }] });
  if (!strict.ok) throw new TemplateServiceError("INVALID_SCHEMA", strict.issues[0]?.message ?? "The questions are invalid.", undefined, strict.issues);
  const block: SavedBlock = {
    id: `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    fields,
    createdAt: new Date().toISOString(),
    createdById: input.actorId,
  };
  return db.$transaction(async (tx) => {
    const row = await tx.appSetting.findUnique({ where: { key: SAVED_BLOCKS_KEY }, select: { value: true } });
    const blocks = parseSavedBlocks(row?.value);
    if (blocks.length >= MAX_SAVED_BLOCKS) {
      throw new TemplateServiceError("INVALID_INPUT", `At most ${MAX_SAVED_BLOCKS} saved blocks. Delete one first.`);
    }
    await writeBlocks(tx, [...blocks, block]);
    return block;
  });
}

export async function deleteSavedBlock(blockId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const row = await tx.appSetting.findUnique({ where: { key: SAVED_BLOCKS_KEY }, select: { value: true } });
    const blocks = parseSavedBlocks(row?.value);
    const kept = blocks.filter((block) => block.id !== blockId);
    if (kept.length === blocks.length) throw new TemplateServiceError("NOT_FOUND", "That block no longer exists.");
    await writeBlocks(tx, kept);
    return true;
  });
}
