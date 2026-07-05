import "./estate.css";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { getThemeForUser } from "@/lib/theme/server";
import { V2ThemeShell } from "./_theme-shell";

/**
 * v2 root layout. Nested inside the app root layout (which owns <html>/<body>
 * and Providers), so this only mounts the Estate skin scope + the theme shell.
 * Individual portal layouts under app/v2/** set their own data-portal-accent.
 */
export default async function V2Layout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions).catch(() => null);
  const initialTheme = await getThemeForUser(session?.user?.id).catch(() => "system" as const);

  return (
    <V2ThemeShell initial={initialTheme}>
      <div data-skin="estate" className="min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))]">
        {children}
      </div>
    </V2ThemeShell>
  );
}
