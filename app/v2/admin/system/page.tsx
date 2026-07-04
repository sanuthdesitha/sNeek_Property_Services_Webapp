import Link from "next/link";
import { ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { Activity, ChevronRight, ClipboardList, Cog, ShieldCheck, Users } from "lucide-react";

export const metadata = { title: "System · Estate admin" };

const GROUPS = [
  { label: "Settings", desc: "Brand & company · Integrations & billing · Ops defaults", icon: Cog },
  { label: "Forms & checklists", desc: "Builder, library, coverage, stats", icon: ClipboardList },
  { label: "Users & roles", desc: "Staff accounts and permissions", icon: Users },
  { label: "Activity log", desc: "Full audit trail", icon: Activity },
  { label: "Diagnostics", desc: "Email, uploads, health checks", icon: ShieldCheck },
];

export default function AdminSystemPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="System" title="Settings & administration" description="Configuration, forms, users, and health — regrouped and searchable." />
      <ECard>
        <ECardBody className="pt-6">
          <div className="divide-y divide-[hsl(var(--e-border))]">
            {GROUPS.map((g) => {
              const Icon = g.icon;
              return (
                <Link key={g.label} href="/v2/admin" className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0 hover:opacity-80">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.875rem] font-medium">{g.label}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{g.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                </Link>
              );
            })}
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
