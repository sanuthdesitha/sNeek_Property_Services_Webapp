import { db } from "@/lib/db";
import type { ThemePreference } from "./context";

const MAP: Record<string, ThemePreference> = {
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
};

export async function getThemeForUser(userId: string | null | undefined): Promise<ThemePreference> {
  if (!userId) return "system";
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { themePreference: true },
  });
  return MAP[user?.themePreference ?? "SYSTEM"] ?? "system";
}
