import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { getDensityForUser } from "@/lib/density/server";
import { DensityProvider } from "@/lib/density/context";
import type { ReactNode } from "react";

/**
 * Server component that reads the current session and yields a DensityProvider
 * pre-populated with the user's stored UI density preference. Wrap portal
 * subtree roots with this.
 */
export async function DensityShell({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  const density = await getDensityForUser(session?.user?.id);
  return <DensityProvider value={density}>{children}</DensityProvider>;
}
