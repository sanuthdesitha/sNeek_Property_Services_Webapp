import { randomUUID } from "crypto";
import { db } from "@/lib/db";

const SUPPLIER_CATALOG_KEY = "inventory_supplier_catalog_v1";

export interface SupplierCatalogRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  defaultLeadDays: number;
  categories: string[];
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoredData {
  suppliers: SupplierCatalogRecord[];
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeRecord(value: unknown): SupplierCatalogRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim().slice(0, 160) : "";
  if (!id || !name) return null;
  const createdAt = typeof row.createdAt === "string" ? new Date(row.createdAt) : null;
  const updatedAt = typeof row.updatedAt === "string" ? new Date(row.updatedAt) : null;
  return {
    id,
    name,
    email:
      typeof row.email === "string" && row.email.trim()
        ? row.email.trim().toLowerCase().slice(0, 200)
        : null,
    phone:
      typeof row.phone === "string" && row.phone.trim() ? row.phone.trim().slice(0, 64) : null,
    website:
      typeof row.website === "string" && row.website.trim()
        ? row.website.trim().slice(0, 400)
        : null,
    defaultLeadDays: Math.max(0, Math.min(60, Math.round(toNumber(row.defaultLeadDays, 0)))),
    categories: Array.isArray(row.categories)
      ? Array.from(
          new Set(
            row.categories
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim().slice(0, 80))
              .filter(Boolean)
          )
        )
      : [],
    notes:
      typeof row.notes === "string" && row.notes.trim() ? row.notes.trim().slice(0, 4000) : null,
    isActive: row.isActive !== false,
    createdAt:
      createdAt && !Number.isNaN(createdAt.getTime())
        ? createdAt.toISOString()
        : new Date().toISOString(),
    updatedAt:
      updatedAt && !Number.isNaN(updatedAt.getTime())
        ? updatedAt.toISOString()
        : new Date().toISOString(),
  };
}

async function readStore(): Promise<StoredData> {
  const row = await db.appSetting.findUnique({ where: { key: SUPPLIER_CATALOG_KEY } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { suppliers: [] };
  const suppliers = Array.isArray((value as any).suppliers)
    ? ((value as any).suppliers as unknown[])
        .map(sanitizeRecord)
        .filter((item): item is SupplierCatalogRecord => Boolean(item))
    : [];
  return { suppliers };
}

async function writeStore(data: StoredData) {
  await db.appSetting.upsert({
    where: { key: SUPPLIER_CATALOG_KEY },
    create: { key: SUPPLIER_CATALOG_KEY, value: { suppliers: data.suppliers } as any },
    update: { value: { suppliers: data.suppliers } as any },
  });
}

export async function listSupplierCatalog() {
  const store = await readStore();
  return store.suppliers.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSupplierById(id: string) {
  const suppliers = await listSupplierCatalog();
  return suppliers.find((supplier) => supplier.id === id) ?? null;
}

export async function createSupplier(input: {
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  defaultLeadDays?: number;
  categories?: string[];
  notes?: string | null;
  isActive?: boolean;
}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const created: SupplierCatalogRecord = {
    id: randomUUID(),
    name: input.name.trim().slice(0, 160),
    email: input.email?.trim().toLowerCase().slice(0, 200) || null,
    phone: input.phone?.trim().slice(0, 64) || null,
    website: input.website?.trim().slice(0, 400) || null,
    defaultLeadDays: Math.max(0, Math.min(60, Math.round(Number(input.defaultLeadDays ?? 0)))),
    categories: Array.from(new Set((input.categories ?? []).map((item) => item.trim()).filter(Boolean))),
    notes: input.notes?.trim().slice(0, 4000) || null,
    isActive: input.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  store.suppliers.push(created);
  if (store.suppliers.length > 300) {
    store.suppliers = store.suppliers.slice(-300);
  }
  await writeStore(store);
  return created;
}

export async function updateSupplierById(
  id: string,
  patch: Partial<Omit<SupplierCatalogRecord, "id" | "createdAt" | "updatedAt">>
) {
  const store = await readStore();
  const index = store.suppliers.findIndex((supplier) => supplier.id === id);
  if (index === -1) return null;
  const existing = store.suppliers[index];
  const updated: SupplierCatalogRecord = {
    ...existing,
    name: patch.name !== undefined ? patch.name.trim().slice(0, 160) || existing.name : existing.name,
    email:
      patch.email !== undefined
        ? patch.email?.trim().toLowerCase().slice(0, 200) || null
        : existing.email,
    phone: patch.phone !== undefined ? patch.phone?.trim().slice(0, 64) || null : existing.phone,
    website:
      patch.website !== undefined
        ? patch.website?.trim().slice(0, 400) || null
        : existing.website,
    defaultLeadDays:
      patch.defaultLeadDays !== undefined
        ? Math.max(0, Math.min(60, Math.round(Number(patch.defaultLeadDays || 0))))
        : existing.defaultLeadDays,
    categories:
      patch.categories !== undefined
        ? Array.from(new Set(patch.categories.map((item) => item.trim()).filter(Boolean)))
        : existing.categories,
    notes: patch.notes !== undefined ? patch.notes?.trim().slice(0, 4000) || null : existing.notes,
    isActive: patch.isActive !== undefined ? patch.isActive : existing.isActive,
    updatedAt: new Date().toISOString(),
  };
  store.suppliers[index] = updated;
  await writeStore(store);
  return updated;
}

export async function deleteSupplierById(id: string) {
  const store = await readStore();
  const before = store.suppliers.length;
  store.suppliers = store.suppliers.filter((supplier) => supplier.id !== id);
  if (store.suppliers.length === before) return false;
  await writeStore(store);
  return true;
}
