import { prisma } from "@/lib/db";
import type { Density } from "./context";

const PRISMA_TO_DENSITY: Record<string, Density> = {
  COMPACT: "compact",
  DEFAULT: "default",
  COMFORTABLE: "comfortable",
};

/**
 * Returns the persisted UI density for a user. Falls back to "default"
 * when the user has no preference or doesn't exist.
 */
export async function getDensityForUser(userId: string | null | undefined): Promise<Density> {
  if (!userId) return "default";
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { uiDensity: true },
  });
  return PRISMA_TO_DENSITY[user?.uiDensity ?? "DEFAULT"] ?? "default";
}
