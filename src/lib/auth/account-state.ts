import { db } from "@/lib/db";

const AUTH_USER_STATE_KEY = "auth_user_state_v1";

export interface AuthUserState {
  userId: string;
  requiresPasswordReset: boolean;
  requiresOnboarding: boolean;
  tutorialSeen: boolean;
  welcomeEmailSent: boolean;
  profileCreationNotified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  users: AuthUserState[];
}

const DEFAULT_STORE: StoreData = { users: [] };

function sanitizeText(value: unknown, max = 120) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function sanitizeState(value: unknown): AuthUserState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const userId = sanitizeText(row.userId, 100);
  if (!userId) return null;
  return {
    userId,
    requiresPasswordReset: row.requiresPasswordReset === true,
    requiresOnboarding: row.requiresOnboarding === true,
    tutorialSeen: row.tutorialSeen === true,
    welcomeEmailSent: row.welcomeEmailSent === true,
    profileCreationNotified: row.profileCreationNotified === true,
    createdAt: sanitizeText(row.createdAt, 40) || new Date().toISOString(),
    updatedAt: sanitizeText(row.updatedAt, 40) || new Date().toISOString(),
  };
}

function sanitizeStore(value: unknown): StoreData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_STORE;
  const row = value as Record<string, unknown>;
  const users = Array.isArray(row.users)
    ? row.users.map(sanitizeState).filter((u): u is AuthUserState => Boolean(u))
    : [];
  return { users };
}

async function readStore() {
  const row = await db.appSetting.findUnique({ where: { key: AUTH_USER_STATE_KEY } });
  return sanitizeStore(row?.value);
}

async function writeStore(data: StoreData) {
  await db.appSetting.upsert({
    where: { key: AUTH_USER_STATE_KEY },
    create: { key: AUTH_USER_STATE_KEY, value: data as any },
    update: { value: data as any },
  });
}

export async function getAuthUserState(userId: string): Promise<AuthUserState | null> {
  const store = await readStore();
  return store.users.find((row) => row.userId === userId) ?? null;
}

export async function upsertAuthUserState(
  userId: string,
  patch: Partial<Omit<AuthUserState, "userId" | "createdAt" | "updatedAt">>
): Promise<AuthUserState> {
  const store = await readStore();
  const index = store.users.findIndex((u) => u.userId === userId);
  const now = new Date().toISOString();
  const current = index >= 0 ? store.users[index] : null;
  const next: AuthUserState = {
    userId,
    requiresPasswordReset:
      patch.requiresPasswordReset !== undefined
        ? patch.requiresPasswordReset
        : current?.requiresPasswordReset ?? false,
    requiresOnboarding:
      patch.requiresOnboarding !== undefined
        ? patch.requiresOnboarding
        : current?.requiresOnboarding ?? false,
    tutorialSeen:
      patch.tutorialSeen !== undefined ? patch.tutorialSeen : current?.tutorialSeen ?? false,
    welcomeEmailSent:
      patch.welcomeEmailSent !== undefined ? patch.welcomeEmailSent : current?.welcomeEmailSent ?? false,
    profileCreationNotified:
      patch.profileCreationNotified !== undefined
        ? patch.profileCreationNotified
        : current?.profileCreationNotified ?? false,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  if (index >= 0) store.users[index] = next;
  else store.users.push(next);
  if (store.users.length > 6000) store.users = store.users.slice(-6000);
  await writeStore(store);
  return next;
}