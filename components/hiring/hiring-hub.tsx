"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Users, Briefcase, UserCheck, Gauge, Search, Mail, Reply, ExternalLink, Copy, Star,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

const PIPELINE = [
  { key: "NEW", label: "New", tone: "bg-slate-400" },
  { key: "SCREENING", label: "Screening", tone: "bg-sky-500" },
  { key: "INTERVIEW", label: "Interview", tone: "bg-amber-500" },
  { key: "OFFER", label: "Offer", tone: "bg-violet-500" },
  { key: "HIRED", label: "Hired", tone: "bg-emerald-500" },
] as const;

const CLOSED = new Set(["REJECTED", "WITHDRAWN"]);

function scoreTone(score: number | null | undefined) {
  if (typeof score !== "number") return "secondary";
  if (score >= 80) return "success";
  if (score >= 60) return "outline";
  return "destructive";
}

export function HiringHub({ positions, applications }: { positions: any[]; applications: any[] }) {
  const [query, setQuery] = useState("");
  const [positionId, setPositionId] = useState<string>("all");
  const [showClosed, setShowClosed] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applications.filter((a) => {
      if (positionId !== "all" && a.positionId !== positionId) return false;
      if (!showClosed && CLOSED.has(a.status)) return false;
      if (!q) return true;
      return (
        a.fullName?.toLowerCase().includes(q) ||
        a.email?.toLowerCase().includes(q) ||
        a.position?.title?.toLowerCase().includes(q)
      );
    });
  }, [applications, query, positionId, showClosed]);

  const stats = useMemo(() => {
    const total = applications.length;
    const inPipeline = applications.filter((a) => !CLOSED.has(a.status) && a.status !== "HIRED").length;
    const hired = applications.filter((a) => a.status === "HIRED").length;
    const scored = applications.filter((a) => typeof a.screeningScore === "number");
    const avg = scored.length ? Math.round(scored.reduce((s, a) => s + a.screeningScore, 0) / scored.length) : null;
    const needsReview = applications.filter((a) => a.status === "NEW").length;
    return { total, inPipeline, hired, avg, needsReview };
  }, [applications]);

  const byStatus = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const stage of PIPELINE) map[stage.key] = [];
    for (const a of filtered) {
      if (map[a.status]) map[a.status].push(a);
    }
    return map;
  }, [filtered]);

  const closedList = useMemo(() => filtered.filter((a) => CLOSED.has(a.status)), [filtered]);

  function copyLink(slug: string) {
    const url = `${window.location.origin}/apply/${slug}`;
    navigator.clipboard.writeText(url).then(
      () => toast({ title: "Link copied", description: url }),
      () => toast({ title: url }),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Briefcase />}
        title="Hiring"
        description="Track candidates through the pipeline, assess them, and keep in touch."
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={Users} label="Candidates" value={String(stats.total)} />
        <StatCard icon={Star} label="Needs review" value={String(stats.needsReview)} accent={stats.needsReview > 0} />
        <StatCard icon={Briefcase} label="In pipeline" value={String(stats.inPipeline)} />
        <StatCard icon={UserCheck} label="Hired" value={String(stats.hired)} />
        <StatCard icon={Gauge} label="Avg score" value={stats.avg != null ? `${stats.avg}%` : "—"} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email…" className="pl-8" />
        </div>
        <Select value={positionId} onValueChange={setPositionId}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All positions</SelectItem>
            {positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant={showClosed ? "default" : "outline"} size="sm" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "Hide closed" : "Show closed"}
        </Button>
      </div>

      {/* Pipeline board */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {PIPELINE.map((stage) => (
          <div key={stage.key} className="rounded-2xl border bg-muted/30 p-2">
            <div className="mb-2 flex items-center justify-between px-1.5 py-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className={`h-2 w-2 rounded-full ${stage.tone}`} /> {stage.label}
              </span>
              <Badge variant="secondary" className="text-[11px]">{byStatus[stage.key].length}</Badge>
            </div>
            <div className="space-y-2">
              {byStatus[stage.key].map((a) => <CandidateCard key={a.id} a={a} />)}
              {byStatus[stage.key].length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">Empty</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {showClosed && closedList.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Closed ({closedList.length})</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {closedList.map((a) => <CandidateCard key={a.id} a={a} muted />)}
          </div>
        </div>
      ) : null}

      {/* Positions */}
      <Card>
        <CardHeader><CardTitle className="text-base">Open roles</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {positions.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {p.title}
                  <Badge variant={p.isPublished ? "success" : "secondary"} className="text-[10px]">
                    {p.isPublished ? "Published" : "Draft"}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">{p._count?.applications ?? 0} applications · /apply/{p.slug}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => copyLink(p.slug)}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy link
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/apply/${p.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                </a>
              </Button>
            </div>
          ))}
          {positions.length === 0 ? <p className="text-sm text-muted-foreground">No roles yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function CandidateCard({ a, muted }: { a: any; muted?: boolean }) {
  return (
    <Link
      href={`/admin/hiring/applications/${a.id}`}
      className={`block rounded-xl border bg-card p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md ${muted ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-semibold">{a.fullName}</p>
        {typeof a.screeningScore === "number" ? (
          <Badge variant={scoreTone(a.screeningScore) as any} className="shrink-0 text-[10px] tabular-nums">
            {Math.round(a.screeningScore)}%
          </Badge>
        ) : null}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.position?.title}</p>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {a.emailsSent ?? 0}</span>
        <span className="inline-flex items-center gap-1"><Reply className="h-3 w-3" /> {a.repliesReceived ?? 0}</span>
        <span className="ml-auto">{new Date(a.createdAt).toLocaleDateString()}</span>
      </div>
    </Link>
  );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card p-3 ${accent ? "border-amber-300/70 bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-0.5 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
