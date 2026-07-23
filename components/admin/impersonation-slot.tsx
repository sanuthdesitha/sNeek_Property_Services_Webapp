import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { resolveImpersonation } from "@/lib/auth/impersonation-server";
import { ImpersonationBar } from "./impersonation-bar";

export type ImpersonationBanner = {
  targetName: string;
  targetRole: string;
  mode: "READ_ONLY" | "FULL";
};

/**
 * Server half of the impersonation banner, mounted in the root layout so the
 * bar follows the admin into every portal, v1 and v2 alike.
 *
 * Uses the RAW session (not requireSession) because it needs the real signed-in
 * id to validate the ticket against — requireSession would already have swapped
 * the identity out. Returns null with no database work when no ticket cookie is
 * present, so the public marketing pages pay nothing for this.
 */
export async function getImpersonationBanner(): Promise<ImpersonationBanner | null> {
  const session = await getServerSession(authOptions);
  const realId = session?.user?.id;
  if (!realId) return null;

  const impersonation = await resolveImpersonation(realId);
  if (!impersonation) return null;

  return {
    targetName: impersonation.target.name || impersonation.target.email || "user",
    targetRole: impersonation.target.role,
    mode: impersonation.mode,
  };
}

export function ImpersonationSlot({ banner }: { banner: ImpersonationBanner }) {
  return <ImpersonationBar {...banner} />;
}
