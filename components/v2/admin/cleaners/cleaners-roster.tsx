"use client";

/**
 * ESTATE cleaners roster — v2-native replacement for the v1 CleanersHub.
 * Same data + same endpoints, new Estate UI:
 *   toggle active  → PATCH /api/admin/users/[id]        { isActive }
 *   add payment    → POST  /api/admin/pay-adjustments   { cleanerId, amount, title, note?, jobNumber?, autoApprove: true }
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Briefcase,
  HandCoins,
  Loader2,
  Mail,
  Phone,
  Search,
  ShieldCheck,
  Star,
  TrendingUp,
  UserCheck,
  UserX,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EStatCard, EThread } from "@/components/v2/ui/primitives";
import {
  EAvatar,
  EField,
  EInput,
  EModal,
  ESelect,
  ETextarea,
} from "@/components/v2/admin/estate-kit";

export type EstateCleanerRow = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  phone: string | null;
  isActive: boolean;
  hourlyRate: number | null;
  joinedAt: string;
  lastSeenAt: string | null;
  quality: number | null;
  reliability: number | null;
  attendance: number | null;
  rating: number | null;
  docCompliance: number | null;
  jobs30d: number;
  reworks30d: number;
  hours30d: number;
  activeJobs: number;
  outstandingPay: number;
};

const money = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n || 0);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);
const rate = (n: number | null) => (n === null ? "—" : `★ ${n.toFixed(2)}`);

type Tone = "neutral" | "success" | "warning" | "danger";
function band(n: number | null): Tone {
  if (n === null) return "neutral";
  if (n >= 85) return "success";
  if (n >= 70) return "warning";
  return "danger";
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-[hsl(var(--e-muted-foreground))]",
  success: "text-[hsl(var(--e-success))]",
  warning: "text-[hsl(var(--e-warning))]",
  danger: "text-[hsl(var(--e-danger))]",
};

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-2.5 py-2">
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--e-text-faint))]">
        {label}
      </p>
      <p className={`e-numeral mt-0.5 text-[0.9375rem] leading-tight ${TONE_TEXT[tone]}`}>{value}</p>
    </div>
  );
}

export function EstateCleanersRoster({ rows }: { rows: EstateCleanerRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [sortBy, setSortBy] = useState("name");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add-extra-payment modal
  const [payFor, setPayFor] = useState<EstateCleanerRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payTitle, setPayTitle] = useState("Extra payment");
  const [payJob, setPayJob] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paySaving, setPaySaving] = useState(false);

  const summary = useMemo(() => {
    const active = rows.filter((r) => r.isActive);
    const qual = active.map((r) => r.quality).filter((n): n is number => n !== null);
    const rat = active.map((r) => r.rating).filter((n): n is number => n !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      total: rows.length,
      active: active.length,
      avgQuality: avg(qual),
      avgRating: avg(rat),
      activeJobs: rows.reduce((s, r) => s + r.activeJobs, 0),
      outstanding: rows.reduce((s, r) => s + r.outstandingPay, 0),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (status === "active" && !r.isActive) return false;
      if (status === "inactive" && r.isActive) return false;
      if (q && !`${r.name ?? ""} ${r.email} ${r.phone ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case "quality":
          return (b.quality ?? -1) - (a.quality ?? -1);
        case "rating":
          return (b.rating ?? -1) - (a.rating ?? -1);
        case "jobs":
          return b.jobs30d - a.jobs30d;
        case "outstanding":
          return b.outstandingPay - a.outstandingPay;
        case "active":
          return b.activeJobs - a.activeJobs;
        default:
          return (a.name ?? a.email).localeCompare(b.name ?? b.email);
      }
    });
    return list;
  }, [rows, search, status, sortBy]);

  async function toggleActive(row: EstateCleanerRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not update", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: row.isActive ? "Cleaner deactivated" : "Cleaner activated" });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  function openPay(row: EstateCleanerRow) {
    setPayFor(row);
    setPayAmount("");
    setPayTitle("Extra payment");
    setPayJob("");
    setPayNote("");
  }

  async function submitPay() {
    if (!payFor) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter a valid amount.", variant: "destructive" });
      return;
    }
    setPaySaving(true);
    try {
      const res = await fetch("/api/admin/pay-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cleanerId: payFor.id,
          amount,
          title: payTitle.trim() || "Extra payment",
          note: payNote.trim() || undefined,
          jobNumber: payJob.trim() || undefined,
          autoApprove: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not add payment", description: body.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Extra payment added & approved",
        description: "It will appear on the cleaner's next invoice.",
      });
      setPayFor(null);
      router.refresh();
    } finally {
      setPaySaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <EStatCard label="Cleaners" value={summary.total} icon={<Users className="h-4 w-4" />} />
        <EStatCard label="Active" value={summary.active} icon={<UserCheck className="h-4 w-4" />} />
        <EStatCard label="Avg quality" value={pct(summary.avgQuality)} icon={<Star className="h-4 w-4" />} />
        <EStatCard label="Avg rating" value={rate(summary.avgRating)} icon={<TrendingUp className="h-4 w-4" />} />
        <EStatCard label="Active jobs" value={summary.activeJobs} icon={<Briefcase className="h-4 w-4" />} />
        <EStatCard label="Owed (approved)" value={money(summary.outstanding)} icon={<Wallet className="h-4 w-4" />} />
      </section>

      {/* Toolbar */}
      <ECard className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative sm:col-span-2 xl:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
          <EInput
            className="pl-9"
            placeholder="Search name, email or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ESelect value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active only</option>
          <option value="all">All cleaners</option>
          <option value="inactive">Inactive only</option>
        </ESelect>
        <ESelect value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="name">Sort: Name A–Z</option>
          <option value="quality">Sort: Quality</option>
          <option value="rating">Sort: Customer rating</option>
          <option value="jobs">Sort: Jobs (30d)</option>
          <option value="active">Sort: Active jobs</option>
          <option value="outstanding">Sort: Amount owed</option>
        </ESelect>
      </ECard>

      {filtered.length === 0 ? (
        <ECard className="p-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          No cleaners match these filters.
        </ECard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((r) => (
            <ECard key={r.id} className={`p-5 ${r.isActive ? "" : "opacity-70"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <EAvatar name={r.name ?? r.email} image={r.image} size="lg" />
                  <div className="min-w-0">
                    <Link
                      href={`/admin/workforce/performance/${r.id}`}
                      className="block truncate font-[550] text-[hsl(var(--e-foreground))] transition-colors hover:text-[hsl(var(--e-gold-ink))]"
                    >
                      {r.name ?? "Unnamed cleaner"}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:text-[hsl(var(--e-foreground))]">
                        <Mail className="h-3 w-3" />
                        <span className="max-w-[13rem] truncate">{r.email}</span>
                      </a>
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:text-[hsl(var(--e-foreground))]">
                          <Phone className="h-3 w-3" />
                          {r.phone}
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <EBadge tone={r.isActive ? "success" : "neutral"} soft>
                    {r.isActive ? "Active" : "Inactive"}
                  </EBadge>
                  {r.hourlyRate !== null ? (
                    <span className="e-numeral text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      ${r.hourlyRate.toFixed(2)}/hr
                    </span>
                  ) : null}
                </div>
              </div>

              <EThread className="my-4" />

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                <Metric label="Quality 30d" value={pct(r.quality)} tone={band(r.quality)} />
                <Metric label="Reliability" value={pct(r.reliability)} tone={band(r.reliability)} />
                <Metric label="Attendance" value={pct(r.attendance)} tone={band(r.attendance)} />
                <Metric
                  label="Rating"
                  value={rate(r.rating)}
                  tone={r.rating === null ? "neutral" : r.rating >= 4.3 ? "success" : r.rating >= 3.5 ? "warning" : "danger"}
                />
                <Metric label="Jobs 30d" value={String(r.jobs30d)} />
                <Metric label="Hours 30d" value={`${r.hours30d}h`} />
                <Metric label="Active jobs" value={String(r.activeJobs)} tone={r.activeJobs > 0 ? "warning" : "neutral"} />
                <Metric label="Owed" value={money(r.outstandingPay)} tone={r.outstandingPay > 0 ? "warning" : "neutral"} />
              </div>

              {r.reworks30d > 0 || (r.docCompliance !== null && r.docCompliance < 100) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.reworks30d > 0 ? (
                    <EBadge tone="danger" soft>
                      {r.reworks30d} rework{r.reworks30d === 1 ? "" : "s"} (30d)
                    </EBadge>
                  ) : null}
                  {r.docCompliance !== null && r.docCompliance < 100 ? (
                    <EBadge tone="warning" soft>
                      <ShieldCheck className="h-3 w-3" /> Docs {pct(r.docCompliance)}
                    </EBadge>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <EButton asChild size="sm" variant="outline">
                  <Link href={`/admin/workforce/performance/${r.id}`}>
                    <BarChart3 className="h-3.5 w-3.5" />
                    Performance
                  </Link>
                </EButton>
                <EButton asChild size="sm" variant="outline">
                  <Link href={`/admin/accounts/users/${r.id}`}>
                    <UserCheck className="h-3.5 w-3.5" />
                    Profile
                  </Link>
                </EButton>
                <EButton size="sm" variant="outline-gold" onClick={() => openPay(r)}>
                  <HandCoins className="h-3.5 w-3.5" />
                  Add payment
                </EButton>
                <EButton
                  size="sm"
                  variant="ghost"
                  disabled={busyId === r.id}
                  onClick={() => toggleActive(r)}
                  className={r.isActive ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-success))]"}
                >
                  {busyId === r.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : r.isActive ? (
                    <UserX className="h-3.5 w-3.5" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5" />
                  )}
                  {r.isActive ? "Deactivate" : "Activate"}
                </EButton>
              </div>
            </ECard>
          ))}
        </div>
      )}

      {/* Add extra payment */}
      <EModal
        open={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        eyebrow="Workforce"
        title={`Extra payment — ${payFor?.name ?? payFor?.email ?? ""}`}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <EField label="Amount ($)">
              <EInput
                type="number"
                min={0}
                step="0.01"
                className="e-tnum"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </EField>
            <EField label="Link to job # (optional)">
              <EInput value={payJob} onChange={(e) => setPayJob(e.target.value)} placeholder="Blank = standalone" />
            </EField>
          </div>
          <EField label="Title">
            <EInput value={payTitle} onChange={(e) => setPayTitle(e.target.value)} />
          </EField>
          <EField label="Note (optional)">
            <ETextarea rows={2} value={payNote} onChange={(e) => setPayNote(e.target.value)} />
          </EField>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Approved immediately — it will be added to the cleaner's next invoice.
          </p>
          <EButton className="w-full" variant="gold" onClick={submitPay} disabled={paySaving}>
            {paySaving ? "Adding…" : "Add payment"}
          </EButton>
        </div>
      </EModal>
    </div>
  );
}
