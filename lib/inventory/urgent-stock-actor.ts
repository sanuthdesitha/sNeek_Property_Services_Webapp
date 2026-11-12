import type { StockActor } from "./urgent-stock";

/** The parts of a live session the urgent stock services need. */
export type UrgentStockSessionLike = {
  user: StockActor;
  impersonation?: { actorId: string } | null;
};

/**
 * The acting account for urgent stock writes. While an administrator
 * impersonates someone, the services check the target's own rights (the
 * session user is the target), and audit rows also name the administrator.
 * Without impersonation the session user is passed through unchanged.
 */
export function urgentStockActor(session: UrgentStockSessionLike): StockActor {
  if (!session.impersonation?.actorId) return session.user;
  return { ...session.user, impersonatedBy: session.impersonation.actorId };
}
