"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Award, Briefcase, Sparkles, Star, Trophy } from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EAvatar, EField, EInput, EModal, ESelect, ETextarea, ESwitch } from "@/components/v2/admin/estate-kit";
import { prettify } from "@/components/v2/admin/workforce/utils";

export type RecognitionEntry = {
  id: string;
  title: string;
  message: string | null;
  badgeKey: string;
  celebrationStyle: string;
  createdAt: string;
  user: { id: string; name: string; image: string | null };
  sentByName: string | null;
};

export type LeaderRow = {
  id: string;
  name: string;
  image: string | null;
  role: string;
  qaAverage: number | null;
  monthJobsCompleted: number;
  recognitionsReceived: number;
};

export type RecognitionStaff = { id: string; name: string; role: string };

const BADGE_OPTIONS = [
  "quality_star",
  "spotless",
  "reliable",
  "client_fave",
  "safety_first",
  "initiative",
  "milestone_10",
  "milestone_50",
  "milestone_100",
];
const STYLE_OPTIONS = ["SPOTLIGHT", "TEAM_SHOUTOUT", "GOLD_STAR", "MILESTONE"];

async function postAction(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/admin/workforce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error ?? "Action failed." };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Network error." };
  }
}

export function RecognitionBoard({
  wall,
  spotlight,
  leaderboard,
  staff,
}: {
  wall: RecognitionEntry[];
  spotlight: RecognitionEntry | null;
  leaderboard: { qa: LeaderRow[]; completed: LeaderRow[]; recognition: LeaderRow[] };
  staff: RecognitionStaff[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [userId, setUserId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [badgeKey, setBadgeKey] = React.useState("quality_star");
  const [style, setStyle] = React.useState("SPOTLIGHT");
  const [isPublic, setIsPublic] = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setUserId(staff[0]?.id ?? "");
      setTitle("");
      setMessage("");
      setBadgeKey("quality_star");
      setStyle("SPOTLIGHT");
      setIsPublic(true);
      setError(null);
    }
  }, [open, staff]);

  async function submit() {
    if (!userId || !title.trim()) {
      setError("Pick a team member and add a title.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await postAction({
      action: "SEND_RECOGNITION",
      userId,
      title: title.trim(),
      message: message || null,
      badgeKey,
      celebrationStyle: style,
      isPublic,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not send recognition.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const publicWall = wall;

  return (
    <div className="space-y-6">
      {spotlight ? (
        <ECard variant="ceremony">
          <ECardBody className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
            <EAvatar name={spotlight.user.name} image={spotlight.user.image} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <EBadge tone="gold" soft>
                  <Sparkles className="h-3 w-3" />
                  Spotlight
                </EBadge>
                <EBadge tone="neutral" soft>{prettify(spotlight.badgeKey)}</EBadge>
              </div>
              <p className="mt-2 text-[1.125rem] font-semibold tracking-[-0.01em]">{spotlight.user.name}</p>
              <p className="text-[0.9375rem] text-[hsl(var(--e-gold-ink))]">{spotlight.title}</p>
              {spotlight.message ? (
                <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{spotlight.message}</p>
              ) : null}
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr,1fr]">
        {/* Wall */}
        <ECard>
          <ECardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <ECardTitle className="flex items-center gap-2">
              <Award className="h-4 w-4 text-[hsl(var(--e-gold))]" />
              Wall
            </ECardTitle>
            <EButton size="sm" onClick={() => setOpen(true)}>
              <Sparkles className="h-4 w-4" />
              Give kudos…
            </EButton>
          </ECardHeader>
          <ECardBody className="pt-0">
            {publicWall.length === 0 ? (
              <EEmptyState
                eyebrow="Nothing yet"
                title="No recognition on the wall"
                description="Give kudos to celebrate a great shift and it'll appear here."
              />
            ) : (
              <div className="divide-y divide-[hsl(var(--e-border))]">
                {publicWall.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <EAvatar name={r.user.name} image={r.user.image} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-medium">
                        {r.user.name}
                        <span className="ml-2 text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">
                          {new Date(r.createdAt).toLocaleDateString("en-AU")}
                        </span>
                      </p>
                      <p className="text-[0.8125rem] text-[hsl(var(--e-gold-ink))]">{r.title}</p>
                      {r.message ? (
                        <p className="mt-0.5 line-clamp-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">&ldquo;{r.message}&rdquo;</p>
                      ) : null}
                      <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                        {prettify(r.celebrationStyle)}{r.sentByName ? ` · sent by ${r.sentByName}` : ""}
                      </p>
                    </div>
                    <EBadge tone="gold" soft>{prettify(r.badgeKey)}</EBadge>
                  </div>
                ))}
              </div>
            )}
          </ECardBody>
        </ECard>

        {/* Leaderboards */}
        <ECard>
          <ECardHeader className="pb-2">
            <ECardTitle className="text-[0.95rem]">Leaders · {new Intl.DateTimeFormat("en-AU", { month: "long" }).format(new Date())}</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            <LeaderCard title="QA average" icon={<Star className="h-4 w-4 text-[hsl(var(--e-gold))]" />} rows={leaderboard.qa} metric={(r) => (r.qaAverage === null ? "No reviews yet" : String(r.qaAverage))} />
            <LeaderCard title="Jobs completed" icon={<Briefcase className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />} rows={leaderboard.completed} metric={(r) => String(r.monthJobsCompleted)} />
            <LeaderCard title="Most recognised" icon={<Trophy className="h-4 w-4 text-[hsl(var(--e-gold))]" />} rows={leaderboard.recognition} metric={(r) => String(r.recognitionsReceived)} />
          </ECardBody>
        </ECard>
      </div>

      {/* Give kudos modal */}
      <EModal open={open} onClose={() => setOpen(false)} title="Give kudos" eyebrow="Recognition">
        <div className="space-y-4">
          <EField label="Team member">
            <ESelect value={userId} onChange={(e) => setUserId(e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {prettify(s.role)}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Title">
            <EInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Outstanding turnaround" />
          </EField>
          <EField label="Message">
            <ETextarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What did they do well?" />
          </EField>
          <ChoiceChips label="Badge" value={badgeKey} options={BADGE_OPTIONS} onChange={setBadgeKey} />
          <ChoiceChips label="Style" value={style} options={STYLE_OPTIONS} onChange={setStyle} />
          <ESwitch checked={isPublic} onCheckedChange={setIsPublic} label="Show on the team wall" />
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">They get it in their inbox. The team wall is what every cleaner sees in their hub; unticked, only they and the office see it.</p>
          {error ? <EAlert tone="danger">{error}</EAlert> : null}
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={submit} disabled={busy}>
              {busy ? "Sending…" : "Send kudos"}
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}

function LeaderCard({
  title,
  icon,
  rows,
  metric,
}: {
  title: string;
  icon: React.ReactNode;
  rows: LeaderRow[];
  metric: (r: LeaderRow) => string;
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5 flex items-center gap-2 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
        {icon}
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Not enough data yet.</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3">
              <span className="e-tnum w-4 text-right text-[0.75rem] text-[hsl(var(--e-text-faint))]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{r.name}</span>
              <span className="e-tnum text-[0.875rem] font-semibold">{metric(r)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ChoiceChips({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return (
    <div>
      <p className="mb-1 text-[0.8125rem] font-[550]">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={
              "min-h-9 rounded-full border px-3 text-[0.8125rem] max-sm:min-h-11 " +
              (value === option
                ? "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]"
                : "border-[hsl(var(--e-border-strong))]")
            }
          >
            {prettify(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
