import Link from "next/link";
import { Role } from "@prisma/client";
import {
  Award,
  ChevronRight,
  Clock,
  FileWarning,
  GraduationCap,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  listStaffDirectory,
  listStaffDocumentsForAdmin,
  listStaffDocumentRequestsForAdmin,
  getRecognitionBoard,
} from "@/lib/workforce/service";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { EAvatar } from "@/components/v2/admin/estate-kit";
import { WorkforceSubnav } from "@/components/v2/admin/workforce/workforce-subnav";
import { docExpiryStatus, prettify } from "@/components/v2/admin/workforce/utils";

export const metadata = { title: "Workforce · Estate admin" };
export const dynamic = "force-dynamic";

export default async function WorkforceOverviewPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const [directory, documents, requests, recognition, learnTotal, learnDone] = await Promise.all([
    listStaffDirectory().catch(() => []),
    listStaffDocumentsForAdmin().catch(() => []),
    listStaffDocumentRequestsForAdmin().catch(() => []),
    getRecognitionBoard().catch(() => null),
    db.learningAssignment.count().catch(() => 0),
    db.learningAssignment
      .count({ where: { OR: [{ completedAt: { not: null } }, { status: "COMPLETED" }] } })
      .catch(() => 0),
  ]);

  const now = Date.now();
  const expiring = documents.filter((d) => docExpiryStatus(d.expiresAt, now) === "EXPIRING_SOON");
  const expired = documents.filter((d) => docExpiryStatus(d.expiresAt, now) === "EXPIRED");
  const pendingReview = documents.filter((d) => d.status === "PENDING");
  const outstandingRequests = requests.filter((r) => r.status === "REQUESTED");

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const recognitionsThisMonth =
    recognition?.recentRecognitions.filter((r) => new Date(r.createdAt) >= monthStart).length ?? 0;

  const learnPct = learnTotal > 0 ? Math.round((learnDone / learnTotal) * 100) : null;

  // Attention feed: expired first, then expiring, then pending reviews, then missing.
  const alerts = [
    ...expired.map((d) => ({
      id: `exp-${d.id}`,
      tone: "danger" as const,
      icon: <ShieldAlert className="h-4 w-4" />,
      who: d.user.name ?? "Unknown",
      title: `${d.title} expired`,
      meta: d.expiresAt ? `Expired ${new Date(d.expiresAt).toLocaleDateString("en-AU")}` : "Expired",
    })),
    ...expiring.map((d) => ({
      id: `soon-${d.id}`,
      tone: "warning" as const,
      icon: <Clock className="h-4 w-4" />,
      who: d.user.name ?? "Unknown",
      title: `${d.title} expiring soon`,
      meta: d.expiresAt ? `Due ${new Date(d.expiresAt).toLocaleDateString("en-AU")}` : "Expiring",
    })),
    ...pendingReview.map((d) => ({
      id: `pend-${d.id}`,
      tone: "info" as const,
      icon: <FileWarning className="h-4 w-4" />,
      who: d.user.name ?? "Unknown",
      title: `${d.title} awaiting review`,
      meta: prettify(d.category),
    })),
    ...outstandingRequests.map((r) => ({
      id: `req-${r.id}`,
      tone: "neutral" as const,
      icon: <FileWarning className="h-4 w-4" />,
      who: r.user.name ?? "Unknown",
      title: `${r.title} not yet uploaded`,
      meta: "Requested",
    })),
  ].slice(0, 8);

  const rosterPreview = [...directory]
    .sort((a, b) => (b.qaAverage ?? -1) - (a.qaAverage ?? -1))
    .slice(0, 6);

  const spotlight = recognition?.spotlight ?? null;
  const wall = recognition?.publicWall.slice(0, 4) ?? [];

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Team operations"
        description="Roster health, compliance and recognition — one operational surface for your people."
        actions={
          <EButton asChild variant="outline" size="sm">
            <Link href="/v2/admin/workforce/compliance">Review compliance</Link>
          </EButton>
        }
      />

      <WorkforceSubnav
        active="overview"
        counts={{ compliance: expired.length + expiring.length + pendingReview.length }}
      />

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <EStatCard label="Active staff" value={String(directory.length)} icon={<Users className="h-4 w-4" />} />
        <EStatCard
          label="Docs expired"
          value={String(expired.length)}
          icon={<ShieldAlert className="h-4 w-4" />}
          delta={expired.length > 0 ? "Action needed" : "All current"}
          deltaTone={expired.length > 0 ? "danger" : "success"}
        />
        <EStatCard
          label="Expiring ≤14d"
          value={String(expiring.length)}
          icon={<Clock className="h-4 w-4" />}
          delta={expiring.length > 0 ? "Renew soon" : "Clear"}
          deltaTone={expiring.length > 0 ? "danger" : "success"}
        />
        <EStatCard label="Pending review" value={String(pendingReview.length)} icon={<FileWarning className="h-4 w-4" />} />
        <EStatCard label="Onboarding done" value={learnPct === null ? "—" : `${learnPct}%`} icon={<GraduationCap className="h-4 w-4" />} />
        <EStatCard label="Kudos this month" value={String(recognitionsThisMonth)} icon={<Award className="h-4 w-4" />} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr,1fr]">
        {/* Compliance attention feed */}
        <ECard>
          <ECardHeader className="flex-row items-center justify-between">
            <ECardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
              Needs attention
            </ECardTitle>
            <Link
              href="/v2/admin/workforce/compliance"
              className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-gold-ink))]"
            >
              Open compliance
            </Link>
          </ECardHeader>
          <ECardBody className="pt-0">
            {alerts.length === 0 ? (
              <EEmptyState
                eyebrow="All clear"
                title="Nothing outstanding"
                description="No expired or expiring documents, pending reviews or unfulfilled requests."
              />
            ) : (
              <div className="divide-y divide-[hsl(var(--e-border))]">
                {alerts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                      {a.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-medium">{a.title}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {a.who} · {a.meta}
                      </p>
                    </div>
                    <EBadge tone={a.tone} soft>
                      {a.tone === "danger" ? "Overdue" : a.tone === "warning" ? "Soon" : a.tone === "info" ? "Review" : "Missing"}
                    </EBadge>
                  </div>
                ))}
              </div>
            )}
          </ECardBody>
        </ECard>

        {/* Recognition spotlight */}
        <ECard variant={spotlight ? "ceremony" : "default"}>
          <ECardHeader className="flex-row items-center justify-between">
            <ECardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[hsl(var(--e-gold))]" />
              Recognition
            </ECardTitle>
            <Link
              href="/v2/admin/workforce/recognition"
              className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-gold-ink))]"
            >
              Give kudos
            </Link>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            {spotlight ? (
              <div className="flex items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-3">
                <EAvatar name={spotlight.user.name ?? "?"} image={spotlight.user.image} />
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] font-semibold">{spotlight.user.name}</p>
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-gold-ink))]">{spotlight.title}</p>
                </div>
              </div>
            ) : null}
            {wall.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                No recognition yet. Celebrate a strong shift to get started.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {wall.map((r) => (
                  <li key={r.id} className="flex items-center gap-2.5">
                    <EAvatar name={r.user.name ?? "?"} image={r.user.image} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.8125rem] font-medium">{r.user.name}</p>
                      <p className="truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{r.title}</p>
                    </div>
                    <EBadge tone="gold" soft>
                      {prettify(r.badgeKey)}
                    </EBadge>
                  </li>
                ))}
              </ul>
            )}
          </ECardBody>
        </ECard>
      </div>

      {/* Roster at a glance */}
      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <div>
            <ECardTitle>Team at a glance</ECardTitle>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Top performers by QA average.</p>
          </div>
          <EButton asChild variant="outline" size="sm">
            <Link href="/v2/admin/workforce/roster">Full roster</Link>
          </EButton>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rosterPreview.map((u) => (
              <Link
                key={u.id}
                href={`/v2/admin/workforce/performance/${u.id}`}
                className="group flex items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 transition-[border-color] hover:border-[hsl(var(--e-border-gold)/0.5)]"
              >
                <EAvatar name={u.name ?? u.email} image={u.image} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.875rem] font-medium">{u.name ?? u.email}</p>
                  <p className="truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                    {[prettify(u.role), u.extendedProfile?.baseLocation].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[0.8125rem]">
                  <Star className="h-3.5 w-3.5 text-[hsl(var(--e-gold))]" />
                  <span className="e-tnum font-semibold">{u.qaAverage ?? "—"}</span>
                </div>
                <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))] transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
