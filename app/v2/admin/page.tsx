import Link from "next/link";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
  EStatCard,
} from "@/components/v2/ui/primitives";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  MapPin,
  Users,
  Wallet,
} from "lucide-react";

export const metadata = { title: "Command · Estate admin" };

const ATTENTION = [
  { tone: "danger" as const, label: "Unassigned", text: "2 jobs today have no cleaner", href: "/v2/admin/jobs" },
  { tone: "warning" as const, label: "Approvals", text: "3 pay adjustments awaiting review", href: "/v2/admin/finance" },
  { tone: "info" as const, label: "QA", text: "1 job flagged below threshold", href: "/v2/admin/quality" },
];

const TODAY = [
  { time: "08:30", property: "12 Marine Parade, Coogee", cleaner: "Ana R.", type: "Airbnb turnover", status: "primary" as const, statusLabel: "En route" },
  { time: "09:00", property: "5/44 Beach St, Bondi", cleaner: "Marco P.", type: "Deep clean", status: "info" as const, statusLabel: "In progress" },
  { time: "10:15", property: "Unit 3, 210 Oxford St", cleaner: "—", type: "End of lease", status: "warning" as const, statusLabel: "Unassigned" },
  { time: "11:00", property: "88 Ocean View Rd", cleaner: "Ana R.", type: "Airbnb turnover", status: "aubergine" as const, statusLabel: "QA review" },
  { time: "14:00", property: "7 Curlewis St, Bondi", cleaner: "Kate L.", type: "General clean", status: "success" as const, statusLabel: "Completed" },
];

export default function AdminCommandPage() {
  return (
    <div className="space-y-8">
      {/* Greeting header */}
      <header className="e-rise">
        <EEyebrow>THURSDAY · 4 JULY · SYDNEY 8°</EEyebrow>
        <h1 className="e-display-lg mt-2">Good morning, Sanuth.</h1>
        <p className="mt-1 text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
          Fourteen jobs on the board — two still need a cleaner.
        </p>
        <div className="e-signature-rule mt-4" />
      </header>

      {/* KPI row */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard label="Jobs today" value="14" delta="2 unassigned" deltaTone="neutral" icon={<CalendarClock className="h-4 w-4" />} />
        <EStatCard label="Revenue · 7d" value="$18,940" delta="+8.1%" icon={<Wallet className="h-4 w-4" />} />
        <EStatCard label="QA pass rate" value="96%" delta="+3 pts" icon={<ClipboardCheck className="h-4 w-4" />} />
        <EStatCard label="Active cleaners" value="6" delta="all checked in" deltaTone="neutral" icon={<Users className="h-4 w-4" />} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Attention queue */}
        <section className="lg:col-span-1">
          <ECard>
            <ECardHeader className="flex-row items-center justify-between">
              <ECardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-warning))]" /> Needs attention
              </ECardTitle>
              <EBadge tone="danger" soft>3</EBadge>
            </ECardHeader>
            <ECardBody className="space-y-2">
              {ATTENTION.map((item) => (
                <Link key={item.text} href={item.href} className="block rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 transition-colors hover:bg-[hsl(var(--e-muted))]">
                  <div className="flex items-center justify-between gap-2">
                    <EBadge tone={item.tone} soft>{item.label}</EBadge>
                    <ArrowRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                  </div>
                  <p className="mt-1.5 text-[0.8125rem]">{item.text}</p>
                </Link>
              ))}
            </ECardBody>
          </ECard>
        </section>

        {/* Today's dispatch */}
        <section className="lg:col-span-2">
          <ECard>
            <ECardHeader className="flex-row items-center justify-between">
              <ECardTitle>Today&apos;s dispatch</ECardTitle>
              <div className="flex gap-2">
                <EButton variant="outline" size="sm"><MapPin className="h-3.5 w-3.5" /> Map</EButton>
                <EButton variant="primary" size="sm">Open board</EButton>
              </div>
            </ECardHeader>
            <ECardBody className="pt-0">
              <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                <table className="w-full text-[0.8125rem]">
                  <thead>
                    <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                      {["Time", "Property", "Cleaner", "Service", "Status"].map((h) => (
                        <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TODAY.map((row, i) => (
                      <tr key={i} className="border-t border-[hsl(var(--e-border)/0.7)] transition-colors hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                        <td className="px-3 py-2.5 font-medium tabular-nums">{row.time}</td>
                        <td className="px-3 py-2.5">{row.property}</td>
                        <td className="px-3 py-2.5 text-[hsl(var(--e-text-secondary))]">{row.cleaner}</td>
                        <td className="px-3 py-2.5 text-[hsl(var(--e-text-secondary))]">{row.type}</td>
                        <td className="px-3 py-2.5"><EBadge tone={row.status} soft>{row.statusLabel}</EBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ECardBody>
          </ECard>
        </section>
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · representative data. Live-data wiring lands during the admin build phase.
      </p>
    </div>
  );
}
