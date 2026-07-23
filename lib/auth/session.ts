import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveImpersonation } from "./impersonation-server";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isActive: true, role: true },
  });
  if (!user?.isActive) {
    throw new Error("UNAUTHORIZED");
  }

  session.user.role = user.role;

  // Admin "test as": swap the session's identity for the impersonated user so
  // every downstream query (which reads session.user.id / .role and knows
  // nothing about this feature) returns exactly what that user would see.
  // resolveImpersonation re-verifies the actor is still an active ADMIN, so the
  // swap can only happen for someone who could already read all of this data.
  // `realUser` is preserved for the banner and for audit at the point of use.
  const impersonation = await resolveImpersonation(user.id);
  if (impersonation) {
    session.user = {
      ...session.user,
      id: impersonation.target.id,
      name: impersonation.target.name,
      email: impersonation.target.email,
      role: impersonation.target.role,
    };
    session.impersonation = {
      actorId: impersonation.actor.id,
      actorName: impersonation.actor.name,
      actorEmail: impersonation.actor.email,
      mode: impersonation.mode,
      startedAt: impersonation.ticket.startedAt,
    };
  }

  return session;
}

/**
 * The genuinely signed-in user, ignoring any impersonation. Use this — never
 * `requireSession()` — for anything that must be attributed to the human at
 * the keyboard, and for the impersonation endpoints themselves (otherwise an
 * impersonated CLEANER session would fail the ADMIN check needed to stop
 * impersonating).
 */
export async function requireRealSession() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isActive: true, role: true },
  });
  if (!user?.isActive) {
    throw new Error("UNAUTHORIZED");
  }
  session.user.role = user.role;
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
    };
    /**
     * Present ONLY while an admin is viewing the app as another user. Its
     * presence is what the warning banner keys off; absent means `user` is the
     * genuine signed-in identity.
     */
    impersonation?: {
      actorId: string;
      actorName?: string | null;
      actorEmail?: string | null;
      mode: "READ_ONLY" | "FULL";
      startedAt: number;
    };
  }
}
