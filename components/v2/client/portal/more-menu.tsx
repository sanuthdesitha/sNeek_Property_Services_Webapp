/**
 * The client More menu (board: "More menu", three groups). Server-renderable:
 * the page passes the sections already filtered for the viewer. Paired rows
 * ("Referrals · Assistants") keep both destinations as separate 44px links.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ClientMoreSection } from "@/components/v2/client/portal/portal-nav";

export function ClientMoreMenu({ sections }: { sections: readonly ClientMoreSection[] }) {
  if (sections.length === 0) {
    return <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Nothing else is shared with this login.</p>;
  }
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {sections.map((section, index) => {
        const headingId = `client-more-${index}`;
        return (
          <section key={section.title} aria-labelledby={headingId} className="min-w-0 space-y-2">
            <h2 id={headingId} className="e-eyebrow">{section.title}</h2>
            <ul className="divide-y divide-[hsl(var(--e-border))] overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
              {section.rows.map((row) => (
                <li key={row.key} className="flex min-h-12 items-stretch">
                  {row.links.map((link, linkIndex) => {
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={
                          "flex min-h-12 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-[0.9375rem] font-[550] hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2" +
                          (linkIndex > 0 ? " border-l border-[hsl(var(--e-border))]" : "")
                        }
                      >
                        <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 text-[hsl(var(--e-accent-portal))]" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{link.label}</span>
                        {row.links.length === 1 ? (
                          <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" aria-hidden />
                        ) : null}
                      </Link>
                    );
                  })}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
