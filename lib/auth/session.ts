import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { MULTITENANCY_ENABLED } from "@/lib/saas/config";
import { enterTenantContext } from "@/lib/saas/tenant-context";

export async function getSession() {
  const session = await getServerSession(authOptions);
  // Central tenant wiring: establish the request's org for the auto-scoping
  // middleware. Covers every authenticated route/page that reads the session —
  // no per-handler wrapping. No-op unless multitenancy is enabled.
  if (MULTITENANCY_ENABLED && session?.user?.organizationId) {
    enterTenantContext(session.user.organizationId);
  }
  return session;
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isActive: true, role: true, organizationId: true },
  });
  if (!user?.isActive) {
    throw new Error("UNAUTHORIZED");
  }

  session.user.role = user.role;
  session.user.organizationId = user.organizationId ?? null;
  // Re-assert from the authoritative DB value (the JWT org could be stale).
  if (MULTITENANCY_ENABLED && user.organizationId) {
    enterTenantContext(user.organizationId);
  }
  return session;
}

export async function requireRole(allowedRoles: Role[]) {
  const session = await requireSession();
  if (!allowedRoles.includes(session.user.role as Role)) {
    throw new Error("FORBIDDEN");
  }
  return session;
}

// Type augmentation for session
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: Role;
      organizationId?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    organizationId?: string | null;
  }
}
