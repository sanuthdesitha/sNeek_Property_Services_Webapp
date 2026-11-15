import "../v2/estate.css";
import { V2ThemeShell } from "../v2/_theme-shell";

/** The client's onboarding link: a public page in the Estate look, no portal shell, no login. */
export default function OnboardingLinkLayout({ children }: { children: React.ReactNode }) {
  return (
    <V2ThemeShell initial="system">
      <div data-skin="estate" data-portal-accent="client" className="min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))]">
        {children}
      </div>
    </V2ThemeShell>
  );
}
