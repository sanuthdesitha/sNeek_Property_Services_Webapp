import Link from "next/link";
import { Role } from "@prisma/client";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { LAUNDRY_MORE_ITEMS } from "@/components/v2/laundry/portal/laundry-nav";
import { LaundryAccountActions } from "@/components/v2/laundry/portal/laundry-account-actions";

export const metadata = { title: "More · Estate laundry" };

/**
 * The More tab (board "More menu (☰)"): every laundry destination that is not
 * a phone tab, each a 44px link. It was a redirect to Today while the drawer
 * held these links; the drawer is replaced by this tab on phones, so the URL
 * is a menu again (and still reachable from old links).
 */
export default async function V2LaundryMorePage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-4">
      <EPageHeader eyebrow="Laundry" title="More" />
      <ul className="divide-y divide-[hsl(var(--e-border))] overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        {LAUNDRY_MORE_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link href={item.href} className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2">
                <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 text-[hsl(var(--e-accent-portal))]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-[550]">{item.label}</span>
                  {item.detail ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.detail}</span> : null}
                </span>
                <ChevronRight className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
      <LaundryAccountActions />
    </div>
  );
}
