"use client";

/**
 * ESTATE-native hiring hub (ATS) — pipeline board + filterable roster of
 * applications, KPIs, and open-role management. Uses the same endpoints as the
 * v1 hub (`/api/admin/workforce/hiring/positions`, `.../applications`) but is a
 * brand-new Estate UI: hairline borders, warm surfaces, serif numerals,
 * champagne accents. No dependency on components/{ui,hiring,admin,shared}.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase, Users, Star, UserCheck, Gauge, Search, Mail, Reply, ExternalLink,
  Copy, Plus, Pencil, LayoutGrid, List as ListIcon, ClipboardList, Loader2,
} from "lucide-react";
import {
  EButton, EPageHeader, EBadge, EStatCard, EEmptyState, ECard,
} from "@/components/v2/ui/primitives";
import {
  EInput, ESelect, EField,
} from "@/components/v2/admin/estate-kit";

const PIPELINE = [
  { key: "NEW", label: "New", tone: "neutral" as const },
  { key: "SCREENING", label: "Screening", tone: "info" as const },
  { key: "INTERVIEW", label: "Interview", tone: "warning" as const },
  { key: "OFFER", label: "Offer", tone: "aubergine" as const },
  { key: "HIRED", label: "Hired", tone: "success" as const },
] as const;

const CLOSED = new Set(["REJECTED", "WITHDRAWN"]);

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function scoreTone(score: number | null | undefined): Tone {
  if (typeof score !== "number") return "neutral";
  if (score >= 80) return "success";
  if (score >= 60) return "gold";
  return "danger";
}

type Application = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  positionId: string;
  position?: { id: string; title: string; slug?: string } | null;
  screeningScore?: number | null;
  emailsSent?: number | null;
  repliesReceived?: number | null;
  createdAt: string;
  quizAssignments?: Array<{ id: string; status: string; score: number | null }>;
};

type Position = {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  _count?: { applications: number };
};

export function HiringPipeline({
  positions,
  applications,
}: {
  positions: Position[];
  applications: Application[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [positionId, setPositionId] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [view, setView] = useState<"board" | "list">("board");
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);

  async function createRole() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/workforce/hiring/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New role", isPublished: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.id) {
        alert(body.error ?? "Could not create role.");
        return;
      }
      router.push(`/v2/admin/hiring/positions/${body.id}`);
    } finally {
      setCreating(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applications.filter((a) => {
      if (positionId !== "all" && a.positionId !== positionId) return false;
      if (stageFilter !== "all" && a.status !== stageFilter) return false;
      if (!showClosed && CLOSED.has(a.status)) return false;
      if (!q) return true;
      return (
        a.fullName?.toLowerCase().includes(q) ||
        a.email?.toLowerCase().includes(q) ||
        a.position?.title?.toLowerCase().includes(q)
      );
    });
  }, [applications, query, positionId, stageFilter, showClosed]);

  const stats = useMemo(() => {
    const total = applications.length;
    const inPipeline = applications.filter((a) => !CLOSED.has(a.status) && a.status !== "HIRED").length;
    const hired = applications.filter((a) => a.status === "HIRED").length;
    const scored = applications.filter((a) => typeof a.screeningScore === "number") as Array<Application & { screeningScore: number }>;
    const avg = scored.length ? Math.round(scored.reduce((s, a) => s + a.screeningScore, 0) / scored.length) : null;
    const needsReview = applications.filter((a) => a.status === "NEW").length;
    return { total, inPipeline, hired, avg, needsReview };
  }, [applications]);

  const byStatus = useMemo(() => {
    const map: Record<string, Application[]> = {};
    for (const stage of PIPELINE) map[stage.key] = [];
    for (const a of filtered) if (map[a.status]) map[a.status].push(a);
    return map;
  }, [filtered]);

  const closedList = useMemo(() => filtered.filter((a) => CLOSED.has(a.status)), [filtered]);

  function copyLink(slug: string) {
    const url = `${window.location.origin}/apply/${slug}`;
    navigator.clipboard.writeText(url).catch(() => {});
  }

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Hiring"
        description="Move candidates through the pipeline, assess them, and keep every conversation on record."
        actions={
          <EButton variant="gold" size="sm" onClick={createRole} disabled={creating}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            New role
          </EButton>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <EStatCard label="Candidates" value={stats.total} icon={<Users className="h-4 w-4" />} />
        <EStatCard
          label="Needs review"
          value={stats.needsReview}
          icon={<Star className="h-4 w-4" />}
          delta={stats.needsReview > 0 ? "Awaiting first look" : undefined}
          deltaTone={stats.needsReview > 0 ? "danger" : "neutral"}
        />
        <EStatCard label="In pipeline" value={stats.inPipeline} icon={<Briefcase className="h-4 w-4" />} />
        <EStatCard label="Hired" value={stats.hired} icon={<UserCheck className="h-4 w-4" />} />
        <EStatCard label="Avg score" value={stats.avg != null ? `${stats.avg}%` : "—"} icon={<Gauge className="h-4 w-4" />} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
          <EInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, role…"
            className="pl-9"
          />
        </div>
        <EField label="Position" className="w-[200px]">
          <ESelect value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="all">All positions</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </ESelect>
        </EField>
        <EField label="Stage" className="w-[160px]">
          <ESelect value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="all">All stages</option>
            {PIPELINE.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
            <option value="REJECTED">Rejected</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </ESelect>
        </EField>
        <div className="inline-flex items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          <button
            type="button"
            onClick={() => setView("board")}
            aria-pressed={view === "board"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--e-radius)] px-3 text-[0.8125rem] font-[550] transition-colors ${view === "board" ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Board
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--e-radius)] px-3 text-[0.8125rem] font-[550] transition-colors ${view === "list" ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"}`}
          >
            <ListIcon className="h-3.5 w-3.5" /> List
          </button>
        </div>
        <EButton variant={showClosed ? "primary" : "outline"} size="sm" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "Hide closed" : "Show closed"}
        </EButton>
      </div>

      {/* Board / List */}
      {view === "board" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {PIPELINE.map((stage) => (
            <div key={stage.key} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2">
              <div className="mb-2 flex items-center justify-between px-1.5 py-1">
                <EBadge tone={stage.tone} soft>{stage.label}</EBadge>
                <span className="e-tnum text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{byStatus[stage.key].length}</span>
              </div>
              <div className="space-y-2">
                {byStatus[stage.key].map((a) => <CandidateCard key={a.id} a={a} />)}
                {byStatus[stage.key].length === 0 ? (
                  <p className="px-2 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">Empty</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ApplicationList applications={filtered} />
      )}

      {showClosed && closedList.length > 0 ? (
        <div>
          <p className="mb-2 e-eyebrow">Closed · {closedList.length}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {closedList.map((a) => <CandidateCard key={a.id} a={a} muted />)}
          </div>
        </div>
      ) : null}

      {applications.length === 0 ? (
        <EEmptyState
          eyebrow="Pipeline"
          title="No candidates yet"
          description="Publish a role and share its apply link — applications land here automatically."
        />
      ) : null}

      {/* Open roles */}
      <ECard>
        <div className="flex items-center justify-between border-b border-[hsl(var(--e-border))] px-6 py-4">
          <div>
            <p className="e-eyebrow mb-1">Positions</p>
            <h3 className="e-display-sm">Open roles</h3>
          </div>
          <EButton variant="outline" size="sm" onClick={createRole} disabled={creating}>
            <Plus className="h-3.5 w-3.5" /> New role
          </EButton>
        </div>
        <div className="space-y-2 p-4">
          {positions.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-[550] text-[hsl(var(--e-foreground))]">
                  {p.title}
                  <EBadge tone={p.isPublished ? "success" : "neutral"} soft>
                    {p.isPublished ? "Published" : "Draft"}
                  </EBadge>
                </p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {p._count?.applications ?? 0} applications · /apply/{p.slug}
                </p>
              </div>
              <EButton variant="outline" size="sm" asChild>
                <Link href={`/v2/admin/hiring/positions/${p.id}`}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Link>
              </EButton>
              <EButton variant="ghost" size="sm" onClick={() => copyLink(p.slug)}>
                <Copy className="h-3.5 w-3.5" /> Copy link
              </EButton>
              <EButton variant="ghost" size="sm" asChild>
                <a href={`/apply/${p.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
              </EButton>
            </div>
          ))}
          {positions.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No roles yet.</p>
          ) : null}
        </div>
      </ECard>
    </div>
  );
}

function quizCaption(a: Application) {
  const quizzes = Array.isArray(a.quizAssignments) ? a.quizAssignments : [];
  if (quizzes.length === 0) return null;
  const completed = quizzes.filter((q) => q.status === "COMPLETED");
  const best = completed.reduce<number | null>(
    (b, q) => (typeof q.score === "number" ? Math.max(b ?? 0, q.score) : b),
    null,
  );
  if (completed.length === quizzes.length) {
    return { tone: "success" as Tone, text: `Quiz done${best != null ? ` · ${Math.round(best)}%` : ""}` };
  }
  if (completed.length > 0) {
    return { tone: "warning" as Tone, text: `Quiz ${completed.length}/${quizzes.length}${best != null ? ` · ${Math.round(best)}%` : ""}` };
  }
  return { tone: "neutral" as Tone, text: "Quiz sent · awaiting" };
}

function CandidateCard({ a, muted }: { a: Application; muted?: boolean }) {
  const quiz = quizCaption(a);
  return (
    <Link
      href={`/v2/admin/hiring/applications/${a.id}`}
      className={`block rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 transition-[border-color,box-shadow] duration-[160ms] hover:border-[hsl(var(--e-border-gold)/0.5)] hover:shadow-[var(--e-elevation-1)] ${muted ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">{a.fullName}</p>
        {typeof a.screeningScore === "number" ? (
          <EBadge tone={scoreTone(a.screeningScore)} soft className="shrink-0 e-tnum">
            {Math.round(a.screeningScore)}%
          </EBadge>
        ) : null}
      </div>
      <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{a.position?.title}</p>
      {quiz ? (
        <div className="mt-1.5">
          <EBadge tone={quiz.tone} soft className="text-[0.625rem]">
            <ClipboardList className="h-3 w-3" /> {quiz.text}
          </EBadge>
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-3 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
        <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {a.emailsSent ?? 0}</span>
        <span className="inline-flex items-center gap-1"><Reply className="h-3 w-3" /> {a.repliesReceived ?? 0}</span>
        <span className="ml-auto e-tnum">{new Date(a.createdAt).toLocaleDateString()}</span>
      </div>
    </Link>
  );
}

function ApplicationList({ applications }: { applications: Application[] }) {
  const stageLabel: Record<string, { label: string; tone: Tone }> = {
    NEW: { label: "New", tone: "neutral" }, SCREENING: { label: "Screening", tone: "info" },
    INTERVIEW: { label: "Interview", tone: "warning" }, OFFER: { label: "Offer", tone: "aubergine" },
    HIRED: { label: "Hired", tone: "success" }, REJECTED: { label: "Rejected", tone: "danger" },
    WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  };
  if (applications.length === 0) {
    return (
      <EEmptyState eyebrow="Roster" title="Nothing matches" description="Adjust the filters to see more candidates." />
    );
  }
  return (
    <ECard className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[0.875rem]">
          <thead>
            <tr className="border-b border-[hsl(var(--e-border))]">
              {["Candidate", "Position", "Stage", "Quiz", "Score", "Applied"].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-gold-ink))] ${i >= 4 ? "text-right" : "text-left"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--e-border))]">
            {applications.map((a) => {
              const stage = stageLabel[a.status] ?? { label: a.status, tone: "neutral" as Tone };
              const quiz = quizCaption(a);
              return (
                <tr key={a.id} className="transition-colors hover:bg-[hsl(var(--e-muted))]">
                  <td className="px-4 py-3">
                    <Link href={`/v2/admin/hiring/applications/${a.id}`} className="font-[550] text-[hsl(var(--e-foreground))] hover:text-[hsl(var(--e-gold-ink))]">
                      {a.fullName}
                    </Link>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{a.email}</p>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--e-text-secondary))]">{a.position?.title ?? "—"}</td>
                  <td className="px-4 py-3"><EBadge tone={stage.tone} soft>{stage.label}</EBadge></td>
                  <td className="px-4 py-3">
                    {quiz ? <EBadge tone={quiz.tone} soft className="text-[0.625rem]">{quiz.text}</EBadge> : <span className="text-[hsl(var(--e-text-faint))]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {typeof a.screeningScore === "number" ? (
                      <EBadge tone={scoreTone(a.screeningScore)} soft className="e-tnum">{Math.round(a.screeningScore)}%</EBadge>
                    ) : <span className="text-[hsl(var(--e-text-faint))]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right e-tnum text-[hsl(var(--e-muted-foreground))]">{new Date(a.createdAt).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ECard>
  );
}
