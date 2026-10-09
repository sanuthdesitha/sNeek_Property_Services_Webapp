import { getOpsPolicy } from "@/lib/rbac/ops-access";
import { resolveSensitiveGrants } from "@/lib/rbac/ops-policy";
import type { SensitiveAction } from "./sensitive-actions";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getUserExtendedProfile,
  upsertUserExtendedProfile,
} from "@/lib/accounts/user-details";

export interface SensitiveActionCredentials {
  pin?: string | null | undefined;
  password?: string | null | undefined;
}

function normalizePin(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "").slice(0, 12);
}

function normalizePassword(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function getAdminPinState(userId: string) {
  const profile = await getUserExtendedProfile(userId);
  return {
    hasPin: Boolean(profile?.adminPinHash),
    updatedAt: profile?.adminPinUpdatedAt ?? null,
  };
}

export async function setAdminPin(userId: string, pin: string) {
  const normalized = normalizePin(pin);
  if (normalized.length < 4) {
    throw new Error("PIN must be at least 4 digits.");
  }
  const adminPinHash = await bcrypt.hash(normalized, 10);
  await upsertUserExtendedProfile(userId, { adminPinHash });
  return { ok: true };
}

export async function clearAdminPin(userId: string) {
  await upsertUserExtendedProfile(userId, { adminPinHash: null });
  return { ok: true };
}

export async function verifySensitiveAction(
  userId: string,
  credentials: SensitiveActionCredentials | null | undefined,
  action?: SensitiveAction,
) {
  const [user, profile] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        passwordHash: true,
        isActive: true,
        extraRoles: { select: { role: true } },
      },
    }),
    getUserExtendedProfile(userId),
  ]);

  if (!user?.isActive) {
    throw new Error("UNAUTHORIZED");
  }
  const roles = [user.role, ...(user.extraRoles ?? []).map((row) => row.role)];
  if (!roles.includes(Role.ADMIN) && !roles.includes(Role.OPS_MANAGER)) {
    throw new Error("FORBIDDEN");
  }

  if (!roles.includes(Role.ADMIN) && action) {
    const grants = resolveSensitiveGrants(await getOpsPolicy(), userId);
    if (grants[action] !== true) throw new Error("FORBIDDEN");
  }

  const pin = normalizePin(credentials?.pin);
  const password = normalizePassword(credentials?.password);

  if (!pin && !password) {
    throw new Error("PIN_OR_PASSWORD_REQUIRED");
  }

  if (pin && profile?.adminPinHash) {
    const ok = await bcrypt.compare(pin, profile.adminPinHash);
    if (ok) return true;
  }

  if (password && user.passwordHash) {
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (ok) return true;
  }

  throw new Error("INVALID_SECURITY_VERIFICATION");
}
