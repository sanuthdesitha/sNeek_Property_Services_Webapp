"use client";

/**
 * The account block at the foot of the laundry More tab: what the phone
 * drawer used to hold (switch role, classic look, sign out). Notifications
 * stay in the bell at the top of the screen.
 */
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { RoleSwitcher } from "@/components/v2/portal/role-switcher";
import { LookSwitchLink } from "@/components/look-switch-link";

export function LaundryAccountActions() {
  return (
    <section aria-labelledby="laundry-more-account" className="space-y-2">
      <h2 id="laundry-more-account" className="e-eyebrow">Account</h2>
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
