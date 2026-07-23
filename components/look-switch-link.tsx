"use client";

import { usePathname } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";

/**
 * "Try the other look" — a personal, reversible switch between the classic app
 * and the Estate redesign.
 *
 * A plain anchor carrying `?look=`, which middleware turns into a cookie and
 * strips: no JavaScript needed to switch, and the preference is already set
 * before the destination page renders, so there is no flash of the old skin.
 * The choice is per browser and beats the house default, which is what lets
 * one person evaluate a look without imposing it on the team.
 */

/** Maps the current path to the same portal in the other version. */
function counterpart(pathname: string): { href: string; target: "v1" | "v2" } {
  const pairs: [string, string][] = [
    ["/admin", "/v2/admin"],
    ["/cleaner", "/v2/cleaner"],
    ["/client", "/v2/client"],
    ["/laundry", "/v2/laundry"],
    ["/qa", "/v2/qa"],
    ["/maintenance", "/v2/maintenance"],
  ];
  if (pathname === "/v2" || pathname.startsWith("/v2/")) {
    for (const [v1, v2] of pairs) {
      if (pathname === v2 || pathname.startsWith(`${v2}/`)) return { href: v1, target: "v1" };
    }
    return { href: "/", target: "v1" };
  }
  for (const [v1, v2] of pairs) {
    if (pathname === v1 || pathname.startsWith(`${v1}/`)) return { href: v2, target: "v2" };
  }
  return { href: "/v2", target: "v2" };
}

export function LookSwitchLink({ className }: { className?: string }) {
  const pathname = usePathname() || "/";
  const { href, target } = counterpart(pathname);
  // Always lands on the portal ROOT of the other version, never the matching
  // deep page — the equivalent page may not exist there, and a 404 is a much
  // worse outcome than starting from the dashboard.
  const label = target === "v2" ? "Try the Estate look" : "Back to the classic look";
  return (
    <a
      href={`${href}?look=${target}`}
      title={label}
      className={
        className ??
        "inline-flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-sidebar-fg))]/60 transition-colors hover:text-[hsl(var(--e-sidebar-fg))]"
      }
    >
      <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
      {label}
    </a>
  );
}
