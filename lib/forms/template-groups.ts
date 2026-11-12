import "server-only";
/**
 * Groups (folders) in the forms library. A group only organises the admin
 * list: job-form resolution never reads it. Deleting a group leaves its forms
 * ungrouped (FK ON DELETE SET NULL); no template is removed or changed.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { TemplateServiceError } from "./template-errors";
import type { FormGroupSummary } from "./library-types";

export const groupNameZ = z.string().trim().min(1, "Give the group a name.").max(60, "Keep group names under 60 characters.");

export const createGroupSchema = z.object({ name: groupNameZ, sortOrder: z.number().int().min(0).max(10_000).optional() });
export const updateGroupSchema = z
  .object({ name: groupNameZ.optional(), sortOrder: z.number().int().min(0).max(10_000).optional() })
  .refine((value) => value.name !== undefined || value.sortOrder !== undefined, "Nothing to change.");

export async function listFormGroups(): Promise<FormGroupSummary[]> {
  const [groups, counts] = await Promise.all([
    db.formTemplateGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.formTemplate.groupBy({ by: ["groupId"], where: { archivedAt: null, groupId: { not: null } }, _count: { _all: true } }),
  ]);
  const countByGroup = new Map(counts.map((row) => [row.groupId, row._count._all]));
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    sortOrder: group.sortOrder,
    formCount: countByGroup.get(group.id) ?? 0,
  }));
}

async function assertUniqueName(name: string, exceptId?: string) {
  const clash = await db.formTemplateGroup.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new TemplateServiceError("INVALID_INPUT", `A group called "${name}" already exists.`);
}

export async function createFormGroup(input: z.infer<typeof createGroupSchema>) {
  await assertUniqueName(input.name);
  const last = await db.formTemplateGroup.aggregate({ _max: { sortOrder: true } });
  return db.formTemplateGroup.create({
    data: { name: input.name, sortOrder: input.sortOrder ?? (last._max.sortOrder ?? -1) + 1 },
  });
}

export async function updateFormGroup(id: string, input: z.infer<typeof updateGroupSchema>) {
  const existing = await db.formTemplateGroup.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new TemplateServiceError("NOT_FOUND", "Group not found.");
  if (input.name) await assertUniqueName(input.name, id);
  return db.formTemplateGroup.update({ where: { id }, data: input });
}

export async function deleteFormGroup(id: string): Promise<{ ungrouped: number }> {
  const existing = await db.formTemplateGroup.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new TemplateServiceError("NOT_FOUND", "Group not found.");
  const ungrouped = await db.formTemplate.count({ where: { groupId: id } });
  await db.formTemplateGroup.delete({ where: { id } });
  return { ungrouped };
}
