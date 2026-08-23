"use client";

/**
 * ONE PERSON, MORE THAN ONE JOB — the control that changes which one.
 *
 * Someone who both cleans and inspects has two portals, and until this existed
 * the only way into the second was to know its URL. This renders in the rail
 * footer of every portal shell and offers the hats they actually hold.
 *
 * A SINGLE-ROLE ACCOUNT SEES NOTHING. The server decides that — it returns one
 * option, and one option renders no markup at all. The vast majority of staff
 * have exactly one job and must not gain a control that suggests otherwise.
 *
 * Switching NAVIGATES, and does so with a full page load rather than a router
 * push. The destination portal has its own server layout, its own nav and its
 * own accent, and middleware routes on the cookie this sets — a client-side
 * push would keep the current portal's shell mounted around the new portal's
 * pages, which is the wrong nav in the wrong colour.
 */
import * as React from "react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, UserCog } from "lucide-react";

interface SwitchOption {
  role: string;
  label: string;
  home: string;
}

interface ActiveRoleState {
  activeRole: string;
  /** The server's verdict on whether this person is more than one thing. */
  canSwitch: boolean;
  options: SwitchOption[];
}

export function RoleSwitcher() {
  const [state, setState] = React.useState<ActiveRoleState | null>(null);
  const [switching, setSwitching] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/me/active-role", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.options) return;
        setState({
          activeRole: String(body.activeRole),
          canSwitch: body.canSwitch === true,
          options: body.options as SwitchOption[],
        });
      })
      // A failed read leaves the switcher absent rather than showing an error in
      // the nav rail: nobody asked for it, and a broken control where the sign-out
      // button lives is worse than no control. The switch itself — which somebody
      // did ask for — reports its failures loudly, below.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function switchTo(option: SwitchOption) {
    if (option.role === state?.activeRole || switching) return;
    setSwitching(option.role);
    try {
      const res = await fetch("/api/me/active-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: option.role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not switch role.");
      // assign(), not push(): see the note at the top of the file. The server
      // must re-render the destination portal with the new cookie in hand.
      window.location.assign(body.home ?? option.home);
    } catch (err: any) {
      setSwitching(null);
      toast({
        title: "Could not switch role",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    }
  }

  if (!state || !state.canSwitch) return null;

  return (
    <div className="mb-3">
      <p className="mb-1.5 inline-flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-sidebar-fg))]/50">
        <UserCog className="h-3 w-3" aria-hidden />
        Working as
      </p>
      <div className="flex flex-wrap gap-1.5">
        {state.options.map((option) => {
          const active = option.role === state.activeRole;
          const busy = switching === option.role;
          return (
            <button
              key={option.role}
              type="button"
              onClick={() => switchTo(option)}
              disabled={active || switching !== null}
              aria-current={active ? "true" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] px-2.5 py-1 text-[0.6875rem] font-[550] transition-colors duration-150",
                active
                  ? "bg-[hsl(var(--e-sidebar-active-bg))] text-[hsl(var(--e-sidebar-active-fg))] ring-1 ring-[hsl(var(--e-gold))]"
                  : "text-[hsl(var(--e-sidebar-fg))]/70 ring-1 ring-[hsl(var(--e-sidebar-hairline))] hover:bg-white/5 hover:text-[hsl(var(--e-sidebar-fg))]",
                switching !== null && !busy ? "opacity-50" : null
              )}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
