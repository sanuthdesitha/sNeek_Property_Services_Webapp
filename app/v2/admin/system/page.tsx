import Link from "next/link";
import { ECard, ECardBody, ECardHeader, ECardTitle, EPageHeader } from "@/components/v2/ui/primitives";
import {
  Activity, Boxes, Building2, CalendarRange, ChevronRight, ClipboardCheck, ClipboardList,
  Cog, FileText, Inbox, Map, ShieldCheck, Sparkles, Users, Wallet,
  Wrench, Tags, Truck, ListChecks, UserCircle, Briefcase,
} from "lucide-react";

export const metadata = { title: "System · Estate admin" };

const SECTIONS: { title: string; items: { label: string; desc: string; icon: typeof Cog; href: string }[] }[] = [
  {
    title: "Operations",
    items: [
      { label: "Live ops", desc: "Dispatch blockers, routes, expiring docs", icon: Map, href: "/v2/admin/ops" },
      { label: "Calendar", desc: "Week-ahead job agenda", icon: CalendarRange, href: "/v2/admin/calendar" },
      { label: "Approvals", desc: "Pending across every queue", icon: Inbox, href: "/v2/admin/approvals" },
      { label: "Cases", desc: "Disputes, damage & issue tickets", icon: ClipboardCheck, href: "/v2/admin/cases" },
      { label: "Maintenance", desc: "Repairs & replacements oversight", icon: Wrench, href: "/v2/admin/maintenance" },
    ],
  },
  {
    title: "People & property",
    items: [
      { label: "Accounts", desc: "Staff & client overview", icon: Users, href: "/v2/admin/accounts" },
      { label: "Cleaners", desc: "Roster, rates, active jobs, owed", icon: Sparkles, href: "/v2/admin/cleaners" },
      { label: "Properties", desc: "Portfolio & job history", icon: Building2, href: "/v2/admin/properties" },
      { label: "Users & roles", desc: "Staff accounts and permissions", icon: Users, href: "/v2/admin/users" },
    ],
  },
  {
    title: "Commercial",
    items: [
      { label: "Payroll", desc: "Pay runs & settlements", icon: Wallet, href: "/v2/admin/payroll" },
      { label: "Quotes & leads", desc: "Pipeline and accepted value", icon: FileText, href: "/v2/admin/quotes" },
      { label: "Reports", desc: "Client-facing job reports", icon: FileText, href: "/v2/admin/reports" },
      { label: "Inventory", desc: "Stock, shopping & suppliers", icon: Boxes, href: "/v2/admin/inventory" },
      { label: "Pricing", desc: "Rate card, margins & per-service rates", icon: Tags, href: "/v2/admin/pricing" },
      { label: "Delivery profiles", desc: "Report & invoice recipients", icon: Truck, href: "/v2/admin/delivery-profiles" },
      { label: "Hiring", desc: "ATS pipeline, applications & quizzes", icon: Briefcase, href: "/v2/admin/hiring" },
    ],
  },
  {
    title: "Configuration",
    items: [
      { label: "Settings", desc: "Brand & company · Integrations & billing · Ops defaults", icon: Cog, href: "/v2/admin/settings" },
      { label: "Checklists library", desc: "Modules, items & coverage", icon: ListChecks, href: "/v2/admin/checklists" },
      { label: "Forms & stats", desc: "Form builder, coverage, stats", icon: ClipboardList, href: "/v2/admin/forms" },
      { label: "Templates", desc: "Email, notification & message designer", icon: FileText, href: "/v2/admin/templates" },
      { label: "Activity log", desc: "Full audit trail", icon: Activity, href: "/v2/admin/activity" },
      { label: "My profile", desc: "Your account, security & 2FA", icon: UserCircle, href: "/v2/admin/profile" },
      { label: "Diagnostics", desc: "Email, uploads, health checks", icon: ShieldCheck, href: "/admin/system" },
    ],
  },
];

export default function AdminSystemPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="System" title="Operations & administration" description="Every operational area, people, commercial and configuration — one place." />
      {SECTIONS.map((section) => (
        <ECard key={section.title}>
          <ECardHeader><ECardTitle>{section.title}</ECardTitle></ECardHeader>
          <ECardBody className="pt-0">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {section.items.map((g) => {
                const Icon = g.icon;
                return (
                  <Link key={g.label} href={g.href} className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0 hover:opacity-80">
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
      ))}
    </div>
  );
}
