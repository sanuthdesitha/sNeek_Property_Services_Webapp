import { db } from "@/lib/db";

const USER_DETAILS_KEY = "user_extended_profiles_v1";

export interface BankDetails {
  accountName: string;
  bankName: string;
  bsb: string;
  accountNumber: string;
}

export interface UserExtendedProfile {
  userId: string;
  businessName: string | null;
  abn: string | null;
  address: string | null;
  contactNumber: string | null;
  bankDetails: BankDetails | null;
  updatedAt: string;
}

interface StoreData {
  profiles: UserExtendedProfile[];
}

const DEFAULT_STORE: StoreData = { profiles: [] };

function sanitizeText(value: unknown, max = 240) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function sanitizeABN(value: unknown): string | null {
  const raw = sanitizeText(value, 32);
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length >= 11 ? digits.slice(0, 11) : raw;
}

function sanitizePhone(value: unknown): string | null {
  const raw = sanitizeText(value, 32);
  return raw || null;
}

function sanitizeBankDetails(value: unknown): BankDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const accountName = sanitizeText(row.accountName, 160);
  const bankName = sanitizeText(row.bankName, 160);
  const bsb = sanitizeText(row.bsb, 16).replace(/[^\d-]/g, "");
  const accountNumber = sanitizeText(row.accountNumber, 32).replace(/[^\d]/g, "");
  if (!accountName && !bankName && !bsb && !accountNumber) return null;
  return {
    accountName,
    bankName,
    bsb,
    accountNumber,
  };
}

function sanitizeProfile(value: unknown): UserExtendedProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const userId = sanitizeText(row.userId, 100);
  if (!userId) return null;
  return {
    userId,
    businessName: sanitizeText(row.businessName, 200) || null,
    abn: sanitizeABN(row.abn),
    address: sanitizeText(row.address, 500) || null,
    contactNumber: sanitizePhone(row.contactNumber),
    bankDetails: sanitizeBankDetails(row.bankDetails),
    updatedAt: sanitizeText(row.updatedAt, 40) || new Date().toISOString(),
  };
}

function sanitizeStore(value: unknown): StoreData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_STORE;
  const row = value as Record<string, unknown>;
  const profiles = Array.isArray(row.profiles)
    ? row.profiles.map(sanitizeProfile).filter((item): item is UserExtendedProfile => Boolean(item))
    : [];
  return { profiles };
}

async function readStore() {
  const row = await db.appSetting.findUnique({ where: { key: USER_DETAILS_KEY } });
  return sanitizeStore(row?.value);
}

async function writeStore(data: StoreData) {
  await db.appSetting.upsert({
    where: { key: USER_DETAILS_KEY },
    create: { key: USER_DETAILS_KEY, value: data as any },
    update: { value: data as any },
  });
}

export async function getUserExtendedProfile(userId: string) {
  const store = await readStore();
  return store.profiles.find((item) => item.userId === userId) ?? null;
}

export async function getUserExtendedProfiles(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, UserExtendedProfile>();
  const store = await readStore();
  const set = new Set(userIds);
  return new Map(
    store.profiles.filter((item) => set.has(item.userId)).map((item) => [item.userId, item])
  );
}

export async function upsertUserExtendedProfile(
  userId: string,
  patch: Partial<Omit<UserExtendedProfile, "userId" | "updatedAt">>
) {
  const store = await readStore();
  const index = store.profiles.findIndex((item) => item.userId === userId);
  const current = index >= 0 ? store.profiles[index] : null;
  const next: UserExtendedProfile = {
    userId,
    businessName:
      patch.businessName !== undefined
        ? sanitizeText(patch.businessName, 200) || null
        : current?.businessName ?? null,
    abn: patch.abn !== undefined ? sanitizeABN(patch.abn) : current?.abn ?? null,
    address:
      patch.address !== undefined ? sanitizeText(patch.address, 500) || null : current?.address ?? null,
    contactNumber:
      patch.contactNumber !== undefined
        ? sanitizePhone(patch.contactNumber)
        : current?.contactNumber ?? null,
    bankDetails:
      patch.bankDetails !== undefined
        ? sanitizeBankDetails(patch.bankDetails)
        : current?.bankDetails ?? null,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) {
    store.profiles[index] = next;
  } else {
    store.profiles.push(next);
  }
  if (store.profiles.length > 2000) {
    store.profiles = store.profiles.slice(-2000);
  }
  await writeStore(store);
  return next;
}

