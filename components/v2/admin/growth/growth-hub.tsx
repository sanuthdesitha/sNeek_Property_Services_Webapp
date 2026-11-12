/**
 * Growth hub blocks as drawn: four figures, then Leads and quotes, Marketing,
 * Website and blog, Hiring and Outbound messages. Server-rendered from
 * lib/growth/summary; a figure without data says so instead of showing zero
 * as a result ("Not enough data", "Opens not recorded").
 */
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EPill } from "@/components/v2/ui/pill";
import { PIPELINE_STAGE_LABELS } from "@/lib/quotes/pipeline-types";
import type { GrowthSummary } from "@/lib/growth/summary-types";

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <p className="e-eyebrow">{label}</p>
      <p className="e-numeral mt-1 text-[1.75rem] leading-none">{value}</p>
      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{note}</p>
    </div>
  );
}

function Block({ title, links, children }: { title: string; links: Array<{ href: string; label: string }>; children: React.ReactNode }) {
  const id = `growth-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-[1rem] font-[650]">{title}</h2>
        <div className="flex flex-wrap gap-3 text-[0.8125rem]">
          {links.map((link) => <Link key={link.href} href={link.href} className="text-[hsl(var(--e-primary))] hover:underline">{link.label}</Link>)}
        </div>
      </div>
      {children}
    </section>
  );
}

function StageRow({ stages }: { stages: Array<[string, number]> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {stages.map(([label, count]) => <EPill key={label}>{label} <span className="e-tnum ml-1">{count}</span></EPill>)}
    </div>
  );
}

export function GrowthHub({ summary, timezone }: { summary: GrowthSummary; timezone: string }) {
  const { leads, campaigns, website, hiring } = summary;
  const delta = leads && leads.newLastMonth > 0 ? leads.newThisMonth - leads.newLastMonth : null;
  const day = (iso: string | null) => (iso ? formatInTimeZone(new Date(iso), timezone, "d MMM") : "—");

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {leads ? (
          <Figure label="New leads" value={String(leads.newThisMonth)} note={delta == null ? "Not enough data to compare with last month" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} on last month`} />
        ) : null}
        {leads ? (
          <Figure label="Quotes won" value={leads.quotesThisMonth > 0 ? `${leads.wonThisMonth} of ${leads.quotesThisMonth}` : "–"} note={leads.quotesThisMonth > 0 ? "Quotes made this month that became jobs" : "Not enough data: no quotes made this month"} />
        ) : null}
        {campaigns ? (
          <Figure
            label="Campaign emails"
            value={campaigns.recipientsThisMonth == null ? "–" : String(campaigns.recipientsThisMonth)}
            note={`${campaigns.opensThisMonth == null ? "Opens not recorded" : `${campaigns.opensThisMonth} opens`} · ${campaigns.sentThisMonth} campaign${campaigns.sentThisMonth === 1 ? "" : "s"} sent`}
          />
        ) : null}
        {hiring ? <Figure label="Applicants" value={String(hiring.applied + hiring.screening + hiring.interview + hiring.offer)} note={`${hiring.applied} to review`} /> : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {leads ? (
          <Block title="Leads and quotes" links={[{ href: "/v2/admin/quotes", label: "Open Quotes and pricing" }]}>
            <StageRow stages={(["new", "contacted", "quoted", "won"] as const).map((stage) => [PIPELINE_STAGE_LABELS[stage], leads.counts[stage]])} />
            {leads.next.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nothing waiting on a next step.</p> : (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {leads.next.map((item) => (
                  <li key={`${item.name}-${item.detail}`} className="flex items-center justify-between gap-3 py-2 text-[0.8125rem]">
                    <span className="min-w-0"><span className="block font-[600]">{item.name}</span><span className="text-[hsl(var(--e-muted-foreground))]">{item.detail}</span></span>
                    {item.href ? <Link href={item.href} className="shrink-0 text-[hsl(var(--e-primary))] hover:underline">{item.label}</Link> : null}
                  </li>
                ))}
              </ul>
            )}
          </Block>
        ) : null}
        {campaigns ? (
          <Block title="Marketing" links={[{ href: "/v2/admin/marketing", label: "Campaigns" }]}>
            {campaigns.recent.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No campaigns yet.</p> : (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {campaigns.recent.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-[0.8125rem]">
                    <span className="min-w-0"><span className="block font-[600]">{item.name}</span><span className="text-[hsl(var(--e-muted-foreground))]">{item.channel.toLowerCase()} · {item.recipients == null ? "recipients not recorded" : `${item.recipients} sent`} · {item.sentAt ? day(item.sentAt) : "not sent"}</span></span>
                    <EPill tone={item.status === "sent" ? "ok" : "neutral"}>{item.status.charAt(0).toUpperCase() + item.status.slice(1)}</EPill>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        ) : null}
        {website ? (
          <Block title="Website and blog" links={[{ href: "/v2/admin/website/preview", label: "Preview site" }, { href: "/v2/admin/website", label: "Edit pages" }]}>
            <p className="text-[0.8125rem]">{website.publishedPosts} published blog post{website.publishedPosts === 1 ? "" : "s"}</p>
            {website.drafts.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No drafts in progress.</p> : (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {website.drafts.map((draft) => (
                  <li key={draft.id} className="flex items-center justify-between gap-3 py-2 text-[0.8125rem]">
                    <span className="min-w-0"><span className="block font-[600]">{draft.title}</span><span className="text-[hsl(var(--e-muted-foreground))]">Blog post · draft · last edit {day(draft.updatedAt)}</span></span>
                    <Link href="/v2/admin/website/blog" className="shrink-0 text-[hsl(var(--e-primary))] hover:underline">Continue</Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        ) : null}
        {hiring ? (
          <Block title="Hiring" links={[{ href: "/v2/admin/hiring/positions", label: "Positions" }, { href: "/v2/admin/hiring/applications", label: "Review applicants" }]}>
            <StageRow stages={[["Applied", hiring.applied], ["Screening", hiring.screening], ["Interview", hiring.interview], ["Offer", hiring.offer]]} />
            {hiring.positions.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No positions yet.</p> : (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {hiring.positions.map((position) => (
                  <li key={position.id} className="flex items-center justify-between gap-3 py-2 text-[0.8125rem]">
                    <span className="min-w-0"><span className="block font-[600]">{position.title}</span><span className="text-[hsl(var(--e-muted-foreground))]">{position.published ? "Published" : "Draft · not published"} · {position.applications} applicant{position.applications === 1 ? "" : "s"}</span></span>
                    <Link href="/v2/admin/hiring/positions" className="shrink-0 text-[hsl(var(--e-primary))] hover:underline">Open</Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        ) : null}
        <Block title="Outbound messages" links={[{ href: "/v2/admin/notifications", label: "Notifications" }, { href: "/v2/admin/messages", label: "Messages" }]}>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Notifications and their wording live in Notifications; client conversations in Messages.</p>
        </Block>
      </div>
    </div>
  );
}
