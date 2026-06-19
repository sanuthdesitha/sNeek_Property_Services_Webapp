import Link from "next/link";
import { LayoutTemplate, FileText, Mail, FileBarChart, BellRing, ArrowRight } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AdminPageShell } from "@/components/admin/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    href: "/admin/templates/email",
    icon: Mail,
    title: "Emails & SMS",
    description: "Visual block builder for transactional emails (text, images, buttons, colours) plus the matching SMS — per event, with live preview.",
  },
  {
    href: "/admin/forms",
    icon: FileText,
    title: "Forms & checklists",
    description: "Drag-and-drop builder for cleaner job forms and checklists: sections, field types, conditions, scoring, and theming.",
  },
  {
    href: "/admin/reports/themes",
    icon: FileBarChart,
    title: "Report templates",
    description: "Layout, sections, colours, logo, and density for the client-facing job reports and QA reports.",
  },
  {
    href: "/admin/notifications",
    icon: BellRing,
    title: "Notification routing",
    description: "Which events go out, on which channels (email / SMS / push), to which roles — plus scheduled reminders.",
  },
];

export default async function TemplatesHubPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <AdminPageShell
      icon={<LayoutTemplate />}
      title="Templates"
      description="Everything customers and staff see — emails, SMS, forms, and reports — edited from one place."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href} className="group">
              <Card className="h-full transition hover:border-primary/50 hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="flex items-center gap-1.5 text-base font-semibold">
                      {s.title}
                      <ArrowRight className="h-4 w-4 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </AdminPageShell>
  );
}
