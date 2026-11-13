"use client";

/**
 * The person's full page (`/v2/admin/accounts/users/[id]`) as drawn on the
 * Cleaner board (People, 2026-11-12): header with Test as, Message, the
 * primary action that follows what is most urgent (a document missing,
 * expired or about to expire → request it; else Message) and More (Person,
 * Sign-in, Danger zone); key facts; tabs (Overview, Jobs, Pay and invoices,
 * Documents, Leave and availability, Quality and coaching, Access, Activity);
 * and the right rail (Contact, Device and last seen, Payroll and bank, Office
 * notes). Every section is the existing panel section, so the panel and the
 * page cannot drift; tabs stay mounted once opened so drafts survive
 * switching. Device is "Not recorded": the app does not store it.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { EPill } from "@/components/v2/ui/pill";
import type { ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";
import { AddPaymentDialog } from "@/components/v2/admin/people/person-page/add-payment-dialog";
import { urgentDocument, personFacts } from "@/components/v2/admin/people/person-page/person-facts";
import { FactStrip } from "@/components/v2/admin/people/fact-strip";
import { Avatar, StatusPill, formatLastSeen, formatMonthYear } from "../hub/account-display";
import { AccountsMessageDialog } from "../hub/accounts-message-dialog";
import { AccessSection, ContactSection } from "./contact-access-sections";
import { ActivitySection } from "./activity-section";
import { AccountEmailsSection } from "./account-emails-section";
import { DocumentsSection } from "./documents-section";
import { NotesSection, PayrollIdentitySection } from "./pay-notes-sections";
import { PayHistorySection, PaySection } from "./pay-section";
import { LeaveSection } from "./leave-section";
import { PayAndTime, RecentJobs, Recognition, VaAccess, WorkKpis } from "./work-sections";
import { PersonActions } from "./person-actions";

const PAGE_TABS = ["overview", "jobs", "pay", "documents", "leave", "quality", "access", "activity"] as const;
type PageTab = (typeof PAGE_TABS)[number];
const TAB_LABEL: Record<PageTab, string> = {
  overview: "Overview", jobs: "Jobs", pay: "Pay and invoices", documents: "Documents", leave: "Leave and availability", quality: "Quality and coaching", access: "Access", activity: "Activity",
};

type Props = { profile: PersonProfile; caps: PersonCapabilities; onChanged: () => void };

function TabBody({ tab, profile, caps, onChanged }: Props & { tab: PageTab }) {
  const props = { profile, caps, onChanged };
  switch (tab) {
    case "overview":
      return (
        <>
          <WorkKpis profile={profile} />
          <div className="grid gap-3 xl:grid-cols-2"><PayHistorySection {...props} /><PayAndTime profile={profile} /></div>
          <div className="grid gap-3 xl:grid-cols-2"><DocumentsSection {...props} /><Recognition profile={profile} /></div>
          <LeaveSection {...props} />
        </>
      );
    case "jobs":
      return <RecentJobs profile={profile} />;
    case "pay":
      return (<><PaySection {...props} /><PayHistorySection {...props} /><PayAndTime profile={profile} /></>);
    case "documents":
      return <DocumentsSection {...props} />;
    case "leave":
      return <LeaveSection {...props} />;
    case "quality":
      return (
        <>
          <WorkKpis profile={profile} />
          <Recognition profile={profile} />
          {profile.isFieldRole ? (
            <div className="flex flex-wrap gap-2">
              <EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/workforce/performance/${profile.id}`}>Full performance</Link></EButton>
              <EButton asChild size="sm" variant="outline"><Link href="/v2/admin/workforce/coaching">Coaching</Link></EButton>
            </div>
          ) : null}
        </>
      );
    case "access":
      return (<><AccessSection {...props} /><VaAccess profile={profile} /></>);
    case "activity":
      return (<><AccountEmailsSection userId={profile.id} /><ActivitySection userId={profile.id} /></>);
  }
}

function Rail({ profile, caps, onChanged }: Props) {
  const props = { profile, caps, onChanged };
  return (
    <aside aria-label="Person details" className="flex w-full flex-col gap-3 lg:w-[340px] lg:flex-none">
      <div id="contact"><ContactSection {...props} /></div>
      <section className="flex flex-col gap-1.5 rounded-[12px] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
        <h2 className="e-eyebrow">Device and last seen</h2>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
          <dt className="text-[hsl(var(--e-muted-foreground))]">Last seen</dt><dd>{formatLastSeen(profile.lastSeenAt, undefined, { invited: profile.status === "INVITED" })}</dd>
          <dt className="text-[hsl(var(--e-muted-foreground))]">Device</dt><dd className="text-[hsl(var(--e-muted-foreground))]">Not recorded</dd>
        </dl>
      </section>
      <PayrollIdentitySection {...props} />
      <NotesSection {...props} />
    </aside>
  );
}

export function PersonFullPage({ profile, caps }: { profile: PersonProfile; caps: PersonCapabilities }) {
  const router = useRouter();
  const [tab, setTab] = useState<PageTab>("overview");
  const [visited, setVisited] = useState<ReadonlySet<PageTab>>(new Set<PageTab>(["overview"]));
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  useEffect(() => {
    setTab("overview");
    setVisited(new Set<PageTab>(["overview"]));
  }, [profile.id]);
  const refresh = () => router.refresh();
  const choose = (next: PageTab) => {
    setTab(next);
    setVisited((current) => new Set(current).add(next));
  };
  const urgent = urgentDocument(profile);
  const backTab = profile.role === "CLEANER" ? "cleaners" : profile.role === "CLIENT" ? "logins" : profile.role === "VA" ? "assistants" : profile.role === "LAUNDRY" ? "partners" : "office";
  const who = profile.name ?? profile.email;
  const messageRow = useMemo(() => [{ id: profile.id, name: profile.name, email: profile.email, phone: profile.phone, role: profile.role, extraRoles: profile.extraRoles.map((extra) => extra.role), status: profile.status, inviteAgeDays: profile.inviteAgeDays, emailVerified: Boolean(profile.emailVerified), twoFactorEnabled: profile.twoFactorEnabled, clientName: profile.client?.name ?? null, documents: { kind: "NONE" as const, label: "" }, jobsWeek: 0, lastSeenAt: profile.lastSeenAt, attention: [] }], [profile]);

  const personItems: ERowMenuItem[] = [
    { key: "edit", label: "Edit details", href: "#contact" },
    ...(caps.isAdmin && profile.isFieldRole ? [{ key: "payment", label: "Add extra payment", onSelect: () => setPaymentOpen(true) }] : []),
    { key: "rate", label: "Change hourly rate", onSelect: () => choose("pay") },
    { key: "upload", label: "Upload a document", onSelect: () => choose("documents") },
    ...(profile.isFieldRole ? [{ key: "coaching", label: "New coaching record", href: "/v2/admin/workforce/coaching" }, { key: "kudos", label: "Give kudos", href: "/v2/admin/workforce/recognition" }] : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={profile.name} email={profile.email} size={48} />
          <div className="min-w-0">
            <Link href={`/v2/admin/accounts?tab=${backTab}&open=${encodeURIComponent(profile.id)}`} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] hover:underline">← People</Link>
            <h1 className="e-display-md flex flex-wrap items-center gap-1.5 break-words">
              {who} <StatusPill status={profile.status} inviteAgeDays={profile.inviteAgeDays} /> <EPill>{profile.roleLabel}</EPill>
              {profile.extraRoles.map((extra) => <EPill key={extra.role} tone="gold">+ {extra.label}</EPill>)}
            </h1>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {[`Since ${formatMonthYear(profile.hireDate ?? profile.createdAt)}`, profile.location.suburb, profile.phone, profile.email, `last seen ${formatLastSeen(profile.lastSeenAt, undefined, { invited: profile.status === "INVITED" })}`].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {caps.isAdmin && profile.testable ? <EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/system/test-as?user=${encodeURIComponent(profile.id)}`}>Test as</Link></EButton> : null}
          {caps.canMessageStaff ? <EButton size="sm" variant={urgent ? "outline" : "primary"} className="max-sm:hidden" onClick={() => setMessageOpen(true)}>Message</EButton> : null}
          {urgent ? <EButton size="sm" variant="primary" className="max-sm:hidden" onClick={() => choose("documents")}>{urgent.action}</EButton> : null}
          <PersonActions profile={profile} caps={caps} personItems={personItems} hideTestAs onChanged={refresh} onDeleted={() => router.push(`/v2/admin/accounts?tab=${backTab}`)} />
        </div>
      </header>

      <FactStrip label="Person facts" facts={personFacts(profile)} collapsible={{ storageKey: "person:facts" }} />

      {/* Phones (board M-People2): the section tabs stay in reach under the app bar. */}
      <div role="tablist" aria-label="Person sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-[hsl(var(--e-border))] px-1 [scrollbar-width:none] max-sm:sticky max-sm:top-16 max-sm:z-20 max-sm:-mx-4 max-sm:bg-[hsl(var(--e-background)/0.95)] max-sm:px-4 max-sm:backdrop-blur">
        {PAGE_TABS.map((key) => (
          <button key={key} id={`page-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`page-panel-${key}`} onClick={() => choose(key)}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[0.8125rem] max-sm:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]", tab === key ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]" : "border-transparent font-[500] text-[hsl(var(--e-muted-foreground))]")}>
            {TAB_LABEL[key]}{key === "documents" ? <span className="e-tnum ml-1">{profile.documents.length}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col">
          {urgent ? (
            <p className="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-[hsl(var(--e-border))] px-4 py-3 text-[0.8125rem]">
              <b>Needs attention:</b> <EPill tone={urgent.tone}>{urgent.badge}</EPill> {urgent.text}
            </p>
          ) : null}
          {PAGE_TABS.filter((key) => visited.has(key)).map((key) => (
            <div key={`${profile.id}-${key}`} id={`page-panel-${key}`} role="tabpanel" aria-labelledby={`page-tab-${key}`} hidden={tab !== key} className="flex flex-col gap-3">
              <TabBody tab={key} profile={profile} caps={caps} onChanged={refresh} />
            </div>
          ))}
        </div>
        <Rail profile={profile} caps={caps} onChanged={refresh} />
      </div>

      {/* Phones (board M-People2): the urgent step (or Message) docked in thumb reach. */}
      {urgent || caps.canMessageStaff ? (
        <EPhoneActionBar
          label="Person actions"
          secondary={urgent && caps.canMessageStaff ? <EButton variant="outline" onClick={() => setMessageOpen(true)}>Message</EButton> : undefined}
          primary={urgent ? <EButton onClick={() => choose("documents")}>{urgent.action}</EButton> : <EButton onClick={() => setMessageOpen(true)}>Message</EButton>}
        />
      ) : null}
      {caps.isAdmin && profile.isFieldRole ? <AddPaymentDialog open={paymentOpen} cleanerId={profile.id} name={who} onClose={() => setPaymentOpen(false)} onSaved={refresh} /> : null}
      {caps.canMessageStaff ? <AccountsMessageDialog open={messageOpen} rows={messageRow} onClose={() => setMessageOpen(false)} onRunningChange={() => undefined} /> : null}
    </div>
  );
}
