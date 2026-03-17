import { db } from "@/lib/db";

const DELIVERY_PROFILES_KEY = "client_delivery_profiles_v1";

export interface ClientDeliveryProfile {
  clientId: string;
  reportRecipients: string[];
  invoiceRecipients: string[];
  autoSendReports: boolean;
  autoSendInvoices: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
}

interface StoredData {
  profiles: ClientDeliveryProfile[];
}

function sanitizeEmailList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    // Simple validation; strict validation is handled in API schema.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    dedupe.add(email);
  }
  return Array.from(dedupe);
}

function sanitizeProfile(value: unknown): ClientDeliveryProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const clientId = typeof row.clientId === "string" ? row.clientId.trim() : "";
  if (!clientId) return null;
  const updatedAtRaw = typeof row.updatedAt === "string" ? new Date(row.updatedAt) : null;
  return {
    clientId,
    reportRecipients: sanitizeEmailList(row.reportRecipients),
    invoiceRecipients: sanitizeEmailList(row.invoiceRecipients),
    autoSendReports: row.autoSendReports === true,
    autoSendInvoices: row.autoSendInvoices === true,
    updatedAt:
      updatedAtRaw && !Number.isNaN(updatedAtRaw.getTime())
        ? updatedAtRaw.toISOString()
        : new Date().toISOString(),
    updatedByUserId:
      typeof row.updatedByUserId === "string" && row.updatedByUserId.trim()
        ? row.updatedByUserId.trim()
        : null,
  };
}

async function readStore(): Promise<StoredData> {
  const row = await db.appSetting.findUnique({ where: { key: DELIVERY_PROFILES_KEY } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { profiles: [] };
  const profiles = Array.isArray((value as any).profiles)
    ? ((value as any).profiles as unknown[])
        .map(sanitizeProfile)
        .filter((item): item is ClientDeliveryProfile => Boolean(item))
    : [];
  return { profiles };
}

async function writeStore(data: StoredData) {
  await db.appSetting.upsert({
    where: { key: DELIVERY_PROFILES_KEY },
    create: { key: DELIVERY_PROFILES_KEY, value: { profiles: data.profiles } as any },
    update: { value: { profiles: data.profiles } as any },
  });
}

export async function listClientDeliveryProfiles() {
  const store = await readStore();
  return store.profiles.sort((a, b) => a.clientId.localeCompare(b.clientId));
}

export async function getClientDeliveryProfile(clientId: string) {
  const profiles = await listClientDeliveryProfiles();
  return profiles.find((profile) => profile.clientId === clientId) ?? null;
}

export async function upsertClientDeliveryProfile(input: {
  clientId: string;
  reportRecipients?: string[];
  invoiceRecipients?: string[];
  autoSendReports?: boolean;
  autoSendInvoices?: boolean;
  updatedByUserId?: string | null;
}) {
  const store = await readStore();
  const index = store.profiles.findIndex((profile) => profile.clientId === input.clientId);
  const existing =
    index >= 0
      ? store.profiles[index]
      : {
          clientId: input.clientId,
          reportRecipients: [],
          invoiceRecipients: [],
          autoSendReports: false,
          autoSendInvoices: false,
          updatedAt: new Date().toISOString(),
          updatedByUserId: null,
        };

  const updated: ClientDeliveryProfile = {
    ...existing,
    reportRecipients:
      input.reportRecipients !== undefined
        ? sanitizeEmailList(input.reportRecipients)
        : existing.reportRecipients,
    invoiceRecipients:
      input.invoiceRecipients !== undefined
        ? sanitizeEmailList(input.invoiceRecipients)
        : existing.invoiceRecipients,
    autoSendReports:
      input.autoSendReports !== undefined
        ? input.autoSendReports
        : existing.autoSendReports,
    autoSendInvoices:
      input.autoSendInvoices !== undefined
        ? input.autoSendInvoices
        : existing.autoSendInvoices,
    updatedAt: new Date().toISOString(),
    updatedByUserId: input.updatedByUserId ?? existing.updatedByUserId,
  };

  if (index >= 0) {
    store.profiles[index] = updated;
  } else {
    store.profiles.push(updated);
  }
  await writeStore(store);
  return updated;
}

function mergeRecipients(
  preferred: string[],
  fallback: string | null | undefined
): string[] {
  const dedupe = new Set<string>();
  for (const email of preferred) {
    const clean = email.trim().toLowerCase();
    if (clean) dedupe.add(clean);
  }
  if (fallback && fallback.trim()) dedupe.add(fallback.trim().toLowerCase());
  return Array.from(dedupe);
}

export async function resolveClientDeliveryRecipients(input: {
  clientId: string | null | undefined;
  fallbackEmail?: string | null;
  kind: "report" | "invoice";
}) {
  const fallback = input.fallbackEmail?.trim() || null;
  if (!input.clientId) return fallback ? [fallback] : [];
  const profile = await getClientDeliveryProfile(input.clientId);
  if (!profile) return fallback ? [fallback] : [];
  return input.kind === "report"
    ? mergeRecipients(profile.reportRecipients, fallback)
    : mergeRecipients(profile.invoiceRecipients, fallback);
}
