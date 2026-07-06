import Link from "next/link";
import { ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { ChevronRight, Globe, Megaphone, Send, MessageSquare } from "lucide-react";

export const metadata = { title: "Growth · Estate admin" };

const AREAS = [
  { label: "Marketing", desc: "Campaigns, social, asset library", icon: Megaphone, href: "/v2/admin/marketing" },
  { label: "Website CMS", desc: "Editor, blog, live preview", icon: Globe, href: "/v2/admin/website" },
  { label: "Comms center", desc: "Notification defaults, send log, delivery", icon: Send, href: "/v2/admin/notifications" },
  { label: "Messages", desc: "Conversations, compose, templates", icon: MessageSquare, href: "/v2/admin/messages" },
];

export default function AdminGrowthPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Growth" title="Grow the business" description="Marketing, the public site, and one outbound comms center." />
      <div className="grid gap-4 sm:grid-cols-3">
        {AREAS.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.label} href={a.href}>
              <ECard className="group h-full transition-shadow duration-200 hover:shadow-[var(--e-elevation-2)]">
                <ECardBody className="space-y-3 pt-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[1rem] font-semibold">{a.label}</p>
                    <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{a.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[hsl(var(--e-gold-ink))] transition-transform group-hover:translate-x-0.5" />
                </ECardBody>
              </ECard>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
