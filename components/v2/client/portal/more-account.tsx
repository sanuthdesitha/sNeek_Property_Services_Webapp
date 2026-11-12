"use client";

/**
 * Account block at the foot of the client More menu. The phone header has no
 * menu button any more, so what the drawer held (switch role, classic look,
 * sign out) lives here; desktop keeps it in the rail footer as before.
 */
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { RoleSwitcher } from "@/components/v2/portal/role-switcher";
import { LookSwitchLink } from "@/components/look-switch-link";

export function ClientMoreAccount() {
  return (
    <section aria-labelledby="client-more-account" className="space-y-2">
      <h2 id="client-more-account" className="e-eyebrow">Signed in</h2>
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Messages and requests are in the top bar; notifications are in the bell.
      </p>
      {/* The switcher and look link are drawn for the dark rail; they keep it here. */}
      <div className="space-y-2 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-sidebar-bg))] p-4">
        <RoleSwitcher />
        <LookSwitchLink />
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/v2/login" })}
          className="flex min-h-11 items-center gap-2 rounded-[var(--e-radius-sm)] px-1 text-[0.875rem] font-[550] text-[hsl(var(--e-sidebar-fg))] hover:bg-white/5 focus-visible:outline focus-visible:outline-2"
        >
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </div>
    </section>
  );
}
