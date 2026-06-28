"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Users, Star, Clock, CheckCircle2, ShieldCheck, Briefcase, HandCoins, Search,
  TrendingUp, UserCheck, UserX, Wallet, Loader2, BarChart3, Phone, Mail, AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { KpiTile } from "@/components/charts";
import { toast } from "@/hooks/use-toast";

export type CleanerStat = {
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

const money = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n || 0);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);
const rate = (n: number | null) => (n === null ? "—" : `★ ${n.toFixed(2)}`);

function band(n: number | null): "success" | "warning" | "destructive" | "secondary" {
  if (n === null) return "secondary";
  if (n >= 85) return "success";
  if (n >= 70) return "warning";
  return "destructive";
}

function Stat({ label, value, tone = "secondary" }: { label: string; value: string; tone?: "success" | "warning" | "destructive" | "secondary" }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised/40 px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <Badge variant={tone as any} className="mt-0.5 tabular-nums">{value}</Badge>
    </div>
  );
}

export function CleanersHub({ rows }: { rows: CleanerStat[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [sortBy, setSortBy] = useState("name");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add-extra-payment dialog
  const [payFor, setPayFor] = useState<CleanerStat | null>(null);
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
        case "quality": return (b.quality ?? -1) - (a.quality ?? -1);
        case "rating": return (b.rating ?? -1) - (a.rating ?? -1);
        case "jobs": return b.jobs30d - a.jobs30d;
        case "outstanding": return b.outstandingPay - a.outstandingPay;
        case "active": return b.activeJobs - a.activeJobs;
        default: return (a.name ?? a.email).localeCompare(b.name ?? b.email);
      }
    });
    return list;
  }, [rows, search, status, sortBy]);

  async function toggleActive(row: CleanerStat) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: "Could not update", description: body.error, variant: "destructive" }); return; }
      toast({ title: row.isActive ? "Cleaner deactivated" : "Cleaner activated" });
      // Reflect immediately without a full reload.
      row.isActive = !row.isActive;
      setSearch((s) => s); // nudge re-render
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  function openPay(row: CleanerStat) {
    setPayFor(row);
    setPayAmount("");
    setPayTitle("Extra payment");
    setPayJob("");
    setPayNote("");
  }

  async function submitPay() {
    if (!payFor) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast({ title: "Enter a valid amount.", variant: "destructive" });
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
      if (!res.ok) { toast({ title: "Could not add payment", description: body.error, variant: "destructive" }); return; }
      toast({ title: "Extra payment added & approved", description: "It will appear on the cleaner's next invoice." });
      setPayFor(null);
      window.location.reload();
    } finally {
      setPaySaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Users />}
        title="Cleaners"
        description="Your whole cleaning team in one place — performance, workload, pay and quick actions."
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Cleaners" value={summary.total} icon={<Users />} tone="primary" />
        <KpiTile label="Active" value={summary.active} icon={<UserCheck />} tone="success" />
        <KpiTile label="Avg quality" value={pct(summary.avgQuality)} icon={<Star />} tone="info" />
        <KpiTile label="Avg rating" value={rate(summary.avgRating)} icon={<TrendingUp />} tone="accent" />
        <KpiTile label="Active jobs" value={summary.activeJobs} icon={<Briefcase />} tone="warning" />
        <KpiTile label="Owed (approved)" value={money(summary.outstanding)} icon={<Wallet />} tone="neutral" />
      </section>

      <Card>
        <CardContent className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="relative sm:col-span-2 xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, email or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="all">All cleaners</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Sort: Name A–Z</SelectItem>
              <SelectItem value="quality">Sort: Quality</SelectItem>
              <SelectItem value="rating">Sort: Customer rating</SelectItem>
              <SelectItem value="jobs">Sort: Jobs (30d)</SelectItem>
              <SelectItem value="active">Sort: Active jobs</SelectItem>
              <SelectItem value="outstanding">Sort: Amount owed</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">No cleaners match these filters.</CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((r) => (
            <Card key={r.id} className={r.isActive ? "" : "opacity-70"}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="" className="h-full w-full object-cover" />
                      ) : (r.name ?? r.email).slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.name ?? "Unnamed cleaner"}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:text-foreground"><Mail className="h-3 w-3" />{r.email}</a>
                        {r.phone ? <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="h-3 w-3" />{r.phone}</a> : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={r.isActive ? "success" : "secondary"}>{r.isActive ? "Active" : "Inactive"}</Badge>
                    {r.hourlyRate !== null ? <span className="text-xs text-muted-foreground tabular-nums">${r.hourlyRate.toFixed(2)}/hr</span> : null}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  <Stat label="Quality 30d" value={pct(r.quality)} tone={band(r.quality)} />
                  <Stat label="Reliability" value={pct(r.reliability)} tone={band(r.reliability)} />
                  <Stat label="Attendance" value={pct(r.attendance)} tone={band(r.attendance)} />
                  <Stat label="Rating" value={rate(r.rating)} tone={r.rating === null ? "secondary" : r.rating >= 4.3 ? "success" : r.rating >= 3.5 ? "warning" : "destructive"} />
                  <Stat label="Jobs 30d" value={String(r.jobs30d)} />
                  <Stat label="Hours 30d" value={`${r.hours30d}h`} />
                  <Stat label="Active jobs" value={String(r.activeJobs)} tone={r.activeJobs > 0 ? "warning" : "secondary"} />
                  <Stat label="Owed" value={money(r.outstandingPay)} tone={r.outstandingPay > 0 ? "warning" : "secondary"} />
                </div>

                {r.reworks30d > 0 || (r.docCompliance !== null && r.docCompliance < 100) ? (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {r.reworks30d > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive"><AlertTriangle className="h-3 w-3" />{r.reworks30d} rework{r.reworks30d === 1 ? "" : "s"} (30d)</span>
                    ) : null}
                    {r.docCompliance !== null && r.docCompliance < 100 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-warning"><ShieldCheck className="h-3 w-3" />Docs {pct(r.docCompliance)}</span>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild size="sm" variant="outline"><Link href={`/admin/workforce/performance/${r.id}`}><BarChart3 className="mr-1.5 h-3.5 w-3.5" />Performance</Link></Button>
                  <Button asChild size="sm" variant="outline"><Link href={`/admin/accounts/users/${r.id}`}><UserCheck className="mr-1.5 h-3.5 w-3.5" />Profile</Link></Button>
                  <Button size="sm" variant="outline" onClick={() => openPay(r)}><HandCoins className="mr-1.5 h-3.5 w-3.5" />Add payment</Button>
                  <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => toggleActive(r)} className={r.isActive ? "text-destructive" : "text-success"}>
                    {busyId === r.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : r.isActive ? <UserX className="mr-1.5 h-3.5 w-3.5" /> : <UserCheck className="mr-1.5 h-3.5 w-3.5" />}
                    {r.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(payFor)} onOpenChange={(open) => !open && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add extra payment — {payFor?.name ?? payFor?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount ($)</Label>
                <Input type="number" min={0} step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Link to job # <span className="text-muted-foreground">(optional)</span></Label>
                <Input value={payJob} onChange={(e) => setPayJob(e.target.value)} placeholder="Blank = standalone" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={payTitle} onChange={(e) => setPayTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Note <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea rows={2} value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Approved immediately — it'll be added to the cleaner's next invoice.</p>
            <Button className="w-full" onClick={submitPay} disabled={paySaving}>
              {paySaving ? "Adding..." : "Add payment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
