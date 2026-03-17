import { randomUUID } from "crypto";
import { db } from "@/lib/db";

const BRANCHES_KEY = "phase3_branches_v1";

export interface BranchRecord {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  suburbs: string[];
  propertyIds: string[];
  userIds: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BranchStore {
  branches: BranchRecord[];
}

function sanitizeString(value: unknown, max = 160) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function sanitizeStringArray(value: unknown, max = 80) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, max))
        .filter(Boolean)
    )
  );
}

function sanitizeBranch(value: unknown): BranchRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = sanitizeString(row.id, 100);
  const name = sanitizeString(row.name, 160);
  if (!id || !name) return null;
  const code = sanitizeString(row.code, 32) || name.toUpperCase().slice(0, 3);
  const createdAtRaw = typeof row.createdAt === "string" ? new Date(row.createdAt) : null;
  const updatedAtRaw = typeof row.updatedAt === "string" ? new Date(row.updatedAt) : null;
  return {
    id,
    name,
    code,
    isActive: row.isActive !== false,
    suburbs: sanitizeStringArray(row.suburbs),
    propertyIds: sanitizeStringArray(row.propertyIds, 100),
    userIds: sanitizeStringArray(row.userIds, 100),
    notes: sanitizeString(row.notes, 2000) || null,
    createdAt:
      createdAtRaw && !Number.isNaN(createdAtRaw.getTime())
        ? createdAtRaw.toISOString()
        : new Date().toISOString(),
    updatedAt:
      updatedAtRaw && !Number.isNaN(updatedAtRaw.getTime())
        ? updatedAtRaw.toISOString()
        : new Date().toISOString(),
  };
}

async function readStore(): Promise<BranchStore> {
  const row = await db.appSetting.findUnique({ where: { key: BRANCHES_KEY } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { branches: [] };
  const branches = Array.isArray((value as any).branches)
    ? ((value as any).branches as unknown[])
        .map(sanitizeBranch)
        .filter((item): item is BranchRecord => Boolean(item))
    : [];
  return { branches };
}

async function writeStore(data: BranchStore) {
  await db.appSetting.upsert({
    where: { key: BRANCHES_KEY },
    create: { key: BRANCHES_KEY, value: { branches: data.branches } as any },
    update: { value: { branches: data.branches } as any },
  });
}

export async function listBranches() {
  const store = await readStore();
  return store.branches.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getBranchById(id: string) {
  const branches = await listBranches();
  return branches.find((branch) => branch.id === id) ?? null;
}

export async function createBranch(input: {
  name: string;
  code?: string;
  suburbs?: string[];
  propertyIds?: string[];
  userIds?: string[];
  notes?: string | null;
  isActive?: boolean;
}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const created: BranchRecord = {
    id: randomUUID(),
    name: input.name.trim().slice(0, 160),
    code: (input.code?.trim().slice(0, 32) || input.name.trim().slice(0, 3).toUpperCase() || "BRN"),
    isActive: input.isActive !== false,
    suburbs: sanitizeStringArray(input.suburbs),
    propertyIds: sanitizeStringArray(input.propertyIds, 100),
    userIds: sanitizeStringArray(input.userIds, 100),
    notes: input.notes?.trim().slice(0, 2000) || null,
    createdAt: now,
    updatedAt: now,
  };
  store.branches.push(created);
  if (store.branches.length > 100) store.branches = store.branches.slice(-100);
  await writeStore(store);
  return created;
}

export async function updateBranchById(
  id: string,
  patch: Partial<Omit<BranchRecord, "id" | "createdAt" | "updatedAt">>
) {
  const store = await readStore();
  const index = store.branches.findIndex((branch) => branch.id === id);
  if (index === -1) return null;
  const existing = store.branches[index];
  const updated: BranchRecord = {
    ...existing,
    name: patch.name !== undefined ? patch.name.trim().slice(0, 160) || existing.name : existing.name,
    code: patch.code !== undefined ? patch.code.trim().slice(0, 32) || existing.code : existing.code,
    isActive: patch.isActive !== undefined ? patch.isActive : existing.isActive,
    suburbs: patch.suburbs !== undefined ? sanitizeStringArray(patch.suburbs) : existing.suburbs,
    propertyIds:
      patch.propertyIds !== undefined
        ? sanitizeStringArray(patch.propertyIds, 100)
        : existing.propertyIds,
    userIds: patch.userIds !== undefined ? sanitizeStringArray(patch.userIds, 100) : existing.userIds,
    notes: patch.notes !== undefined ? patch.notes?.trim().slice(0, 2000) || null : existing.notes,
    updatedAt: new Date().toISOString(),
  };
  store.branches[index] = updated;
  await writeStore(store);
  return updated;
}

export async function deleteBranchById(id: string) {
  const store = await readStore();
  const before = store.branches.length;
  store.branches = store.branches.filter((branch) => branch.id !== id);
  if (store.branches.length === before) return false;
  await writeStore(store);
  return true;
}

export async function resolveBranchPropertyIds(branchId?: string | null) {
  if (!branchId) return null;
  const branch = await getBranchById(branchId);
  if (!branch || !branch.isActive) return [];
  return branch.propertyIds;
}

