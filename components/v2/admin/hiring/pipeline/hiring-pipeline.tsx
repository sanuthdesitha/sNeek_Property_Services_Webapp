"use client";

/**
 * Hiring hub (boards "Hiring" and "Hiring on a phone", 2026-11-16): five
 * figures, search and filters, the five-stage board (drag a card to another
 * stage, or use its "Move to…" menu from the keyboard), a list view, the
 * closed applications behind a switch, and the roles table with "Hires
 * become". A stage move opens the existing email preview first; moving to
 * Hired opens the account step on the application page. On a phone the board
 * is one stage at a time on a swipeable chip row.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EPill } from "@/components/v2/ui/pill";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { EToneCard, toneNoticeClass } from "@/components/v2/ui/tone-band";
import type { HubCard, HubFigure, HubRole } from "@/lib/hiring/hub-data";
import { CLOSED_STAGES, MOVE_TARGETS, moveRefusal, PIPELINE_STAGES, stageLabel, type PipelineStage } from "@/lib/hiring/pipeline";
import { StageMoveFlow, type PendingMove } from "../stage-move";

type TestFilter = "any" | "passed" | "below" | "not-done";

type Message = { text: string; tone: "success" | "danger" };

const DRAG_TYPE = "application/x-sneek-application";

export function HiringPipeline({
  cards,
  roles,
  figures,
  closedCounts,
  capped,
  careersUrl,
}: {
  cards: HubCard[];
  roles: HubRole[];
  figures: HubFigure[];
  closedCounts: { rejected: number; withdrawn: number };
  capped: boolean;
  careersUrl: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useRestorableState("hiring-pipeline:query", "");
  const [roleId, setRoleId] = useRestorableState("hiring-pipeline:role", "all");
  const [testFilter, setTestFilter] = useRestorableState<TestFilter>("hiring-pipeline:test", "any");
  const [view, setView] = useRestorableState<"board" | "list">("hiring-pipeline:view", "board");
  const [phoneStage, setPhoneStage] = useRestorableState<PipelineStage>("hiring-pipeline:phone-stage", "NEW");
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (roleId !== "all" && card.positionId !== roleId) return false;
      if (testFilter === "passed" && card.testPassed !== true) return false;
      if (testFilter === "below" && card.testPassed !== false) return false;
      if (testFilter === "not-done" && card.testDone) return false;
      if (!q) return true;
      return card.name.toLowerCase().includes(q) || card.email.toLowerCase().includes(q) || (card.phone ?? "").replace(/\s+/g, "").includes(q.replace(/\s+/g, ""));
    });
  }, [cards, query, roleId, testFilter]);

  const byStage = useMemo(() => {
    const map = new Map<string, HubCard[]>();
    for (const stage of [...PIPELINE_STAGES, ...CLOSED_STAGES]) map.set(stage, []);
    for (const card of filtered) map.get(card.status)?.push(card);
    return map;
  }, [filtered]);
  const closed = filtered.filter((card) => (CLOSED_STAGES as readonly string[]).includes(card.status));

  async function createRole() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/workforce/hiring/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New role", isPublished: false }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) return setMessage({ text: body.error ?? "The role could not be created.", tone: "danger" });
      router.push(`/v2/admin/hiring/positions/${body.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function copyCareersLink() {
    try {
      await navigator.clipboard.writeText(careersUrl);
      setMessage({ text: `Copied ${careersUrl}`, tone: "success" });
    } catch {
      setMessage({ text: `Copy this link: ${careersUrl}`, tone: "success" });
    }
  }

  function requestMove(card: HubCard, to: string) {
    const refusal = moveRefusal(card.status, to);
    if (refusal && to !== "HIRED") return setMessage({ text: refusal, tone: "danger" });
    if (to === "HIRED" && card.status !== "OFFER") return setMessage({ text: "Make an offer first: hiring happens from the Offer stage.", tone: "danger" });
    setPending({ applicationId: card.id, name: card.name, from: card.status, to });
  }

  function onDrop(event: React.DragEvent, stage: string) {
    event.preventDefault();
    setDragOver(null);
    const id = event.dataTransfer.getData(DRAG_TYPE);
    const card = cards.find((item) => item.id === id);
    if (card && card.status !== stage) requestMove(card, stage);
  }

  const columnProps = (stage: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      setDragOver(stage);
    },
    onDragLeave: () => setDragOver((current) => (current === stage ? null : current)),
    onDrop: (event: React.DragEvent) => onDrop(event, stage),
  });

  const stageChips = PIPELINE_STAGES.map((stage) => ({ key: stage, label: stageLabel(stage), count: byStage.get(stage)?.length ?? 0 }));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="e-display-md">Hiring</h1>
          <p className="mt-1 text-[0.9375rem] text-[hsl(var(--e-muted-foreground))] max-sm:hidden">
            Applications for open roles, from new to hired. A hire becomes a staff account through the same invitation as Invite person.
          </p>
          <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] sm:hidden">
            {figures[1]?.value} in the pipeline · {figures[2]?.value} need a first look · {figures[3]?.value} interviews this week
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:hidden">
          <EButton variant="outline" size="sm" onClick={copyCareersLink}>Copy careers link</EButton>
          <EButton size="sm" onClick={createRole} disabled={creating}>{creating ? "Creating…" : "New role"}</EButton>
        </div>
      </header>
      <div className="e-signature-rule" />

      {message ? (
        <p role={message.tone === "danger" ? "alert" : "status"} className={`rounded-[var(--e-radius-lg)] p-3 text-[0.8125rem] ${toneNoticeClass(message.tone === "danger" ? "problem" : "good")}`}>
          {message.text}
        </p>
      ) : null}

      <ul aria-label="Hiring figures" className="grid grid-cols-2 gap-2.5 max-sm:hidden lg:grid-cols-5">
        {figures.map((figure) => (
          <li key={figure.label} className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2.5">
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{figure.label}</p>
            <p className="e-tnum text-[1.125rem] font-semibold">{figure.value}</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{figure.note}</p>
          </li>
        ))}
      </ul>
      {capped ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Showing the latest 300 applications; older ones are not counted here.</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <EInput aria-label="Search name, email or phone" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or phone" className="min-w-0 flex-1 basis-56 max-sm:text-[16px]" />
        <ESelect aria-label="Role" value={roleId} onChange={(e) => setRoleId(e.target.value)} className="w-auto max-sm:flex-1 max-sm:text-[16px]">
          <option value="all">Role: all</option>
          {roles.map((role) => <option key={role.id} value={role.id}>{role.title}</option>)}
        </ESelect>
        <ESelect aria-label="Knowledge test" value={testFilter} onChange={(e) => setTestFilter(e.target.value as TestFilter)} className="w-auto max-sm:text-[16px]">
          <option value="any">Test: any</option>
          <option value="passed">Test: passed</option>
          <option value="below">Test: below pass mark</option>
          <option value="not-done">Test: not done</option>
        </ESelect>
        <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem] sm:ml-auto">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--e-primary))]" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          <span><span className="sm:hidden">Closed</span><span className="max-sm:hidden">Show closed (rejected {closedCounts.rejected}, withdrawn {closedCounts.withdrawn})</span></span>
        </label>
        <div role="group" aria-label="Layout" className="inline-flex rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-0.5 max-sm:hidden">
          {(["board", "list"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`h-8 rounded-[var(--e-radius-sm)] px-3 text-[0.8125rem] font-[550] ${view === option ? "bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]"}`}
            >
              {option === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
      </div>

      {/* Phone: one stage at a time on a swipeable chip row. */}
      <div className="flex flex-col gap-3 sm:hidden">
        <EFilterChips label="Stage" chips={stageChips} active={phoneStage} onChange={setPhoneStage} phoneLayout="carousel" />
        <StageCards stage={phoneStage} cards={byStage.get(phoneStage) ?? []} onMove={requestMove} />
      </div>

      <div className="max-sm:hidden">
        {view === "board" ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {PIPELINE_STAGES.map((stage) => (
              <section
                key={stage}
                aria-labelledby={`stage-${stage}`}
                {...columnProps(stage)}
                className={`min-w-0 rounded-[var(--e-radius-lg)] p-1 transition-colors ${dragOver === stage ? "bg-[hsl(var(--e-primary-soft))] outline outline-2 outline-[hsl(var(--e-primary)/0.4)]" : ""}`}
              >
                <h2 id={`stage-${stage}`} className="mb-2 flex items-center justify-between px-1 text-[0.8125rem] font-[550]">
                  {stageLabel(stage)}
                  <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{byStage.get(stage)?.length ?? 0}</span>
                </h2>
                <StageCards stage={stage} cards={byStage.get(stage) ?? []} onMove={requestMove} draggable />
              </section>
            ))}
          </div>
        ) : (
          <ApplicationTable cards={filtered.filter((card) => showClosed || !(CLOSED_STAGES as readonly string[]).includes(card.status))} onMove={requestMove} />
        )}
        <p className="mt-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Drag a card to another stage, or use its Move to… menu. Moving into Interview, Offer or Declined opens the email preview with that stage&apos;s template, to send or skip; moving to Hired always opens the account step.
        </p>
      </div>

      {showClosed ? (
        <section aria-labelledby="closed-title" className="min-w-0">
          <h2 id="closed-title" className="mb-2 text-[0.8125rem] font-[550]">Closed · {closed.length}</h2>
          {closed.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No rejected or withdrawn applications match these filters.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {closed.map((card) => <PipelineCard key={card.id} card={card} onMove={requestMove} />)}
            </div>
          )}
        </section>
      ) : null}

      <RolesTable roles={roles} careersUrl={careersUrl} />

      <EPhoneActionBar
        label="Hiring actions"
        secondary={<EButton variant="outline" onClick={copyCareersLink}>Copy link</EButton>}
        primary={<EButton onClick={createRole} disabled={creating}>New role</EButton>}
        hidden={pending !== null}
      />

      <StageMoveFlow
        move={pending}
        onMessage={(text, tone) => setMessage({ text, tone })}
        onFinished={(changed) => {
          setPending(null);
          if (changed) router.refresh();
        }}
      />
    </div>
  );
}

function StageCards({ stage, cards, onMove, draggable = false }: { stage: string; cards: HubCard[]; onMove: (card: HubCard, to: string) => void; draggable?: boolean }) {
  if (cards.length === 0) {
    return <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No applications in {stageLabel(stage)}.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {cards.map((card) => (
        <li key={card.id}>
          <PipelineCard card={card} onMove={onMove} draggable={draggable} />
        </li>
      ))}
    </ul>
  );
}

function moveItems(card: HubCard, onMove: (card: HubCard, to: string) => void) {
  const targets = [...MOVE_TARGETS.filter((stage) => stage !== card.status && stage !== "WITHDRAWN"), "HIRED", "WITHDRAWN"];
  return targets.map((stage, index) => {
    const refusal = stage === "HIRED" ? (card.status === "OFFER" ? null : "Make an offer first") : moveRefusal(card.status, stage);
    return {
      key: stage,
      label: stage === "HIRED" ? "Mark hired and invite…" : stage === "REJECTED" ? "Decline…" : `Move to ${stageLabel(stage)}`,
      heading: index === 0 ? "Move to" : undefined,
      separated: stage === "REJECTED",
      disabled: Boolean(refusal),
      hint: refusal ?? undefined,
      danger: stage === "REJECTED",
      onSelect: () => onMove(card, stage),
    };
  });
}

function PipelineCard({ card, onMove, draggable = false }: { card: HubCard; onMove: (card: HubCard, to: string) => void; draggable?: boolean }) {
  const menu = card.status === "HIRED" ? null : (
    <ERowMenu label={`Move ${card.name}`} items={moveItems(card, onMove)} />
  );
  return (
    <EToneCard
      tone={card.tone}
      draggable={draggable && card.status !== "HIRED"}
      onDragStart={(event: React.DragEvent<HTMLDivElement>) => {
        event.dataTransfer.setData(DRAG_TYPE, card.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={draggable && card.status !== "HIRED" ? "cursor-grab active:cursor-grabbing" : undefined}
      headerClassName="px-3 py-2"
      bodyClassName="px-3 py-2"
      header={
        <div className="min-w-0">
          <Link href={`/v2/admin/hiring/applications/${card.id}`} className="block truncate text-[0.875rem] font-semibold underline-offset-2 hover:underline">
            {card.name}
          </Link>
          <p className="truncate text-[0.75rem] opacity-80">{card.subtitle}</p>
        </div>
      }
      pill={card.pill}
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          {card.test ? <EPill tone={card.test.tone}>{card.test.text}</EPill> : null}
          {card.detail ? <span className="min-w-0 break-words">{card.detail}</span> : null}
        </div>
        {menu ? <div className="shrink-0 [&_button]:h-7 [&_button]:w-7 max-sm:[&_button]:h-11 max-sm:[&_button]:w-11">{menu}</div> : null}
      </div>
    </EToneCard>
  );
}

function ApplicationTable({ cards, onMove }: { cards: HubCard[]; onMove: (card: HubCard, to: string) => void }) {
  if (cards.length === 0) return <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No applications match these filters.</p>;
  return (
    <div role="region" aria-label="Applications" tabIndex={0} className="overflow-x-auto rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <table className="w-full min-w-[720px] text-[0.8125rem]">
        <thead className="bg-[hsl(var(--e-surface-raised))] text-left text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <tr>
            <th className="px-3 py-2 font-[550]">Applicant</th>
            <th className="px-3 py-2 font-[550]">Role</th>
            <th className="px-3 py-2 font-[550]">Stage</th>
            <th className="px-3 py-2 font-[550]">Test</th>
            <th className="px-3 py-2 font-[550]">Now</th>
            <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--e-border))]">
          {cards.map((card) => (
            <tr key={card.id}>
              <td className="px-3 py-2">
                <Link href={`/v2/admin/hiring/applications/${card.id}`} className="font-semibold underline-offset-2 hover:underline">{card.name}</Link>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{card.email}</p>
              </td>
              <td className="px-3 py-2">{card.positionTitle}</td>
              <td className="px-3 py-2"><EPill>{stageLabel(card.status)}</EPill>{card.pill ? <span className="ml-1.5 text-[0.75rem]">{card.pill}</span> : null}</td>
              <td className="px-3 py-2">{card.test ? <EPill tone={card.test.tone}>{card.test.text}</EPill> : "–"}</td>
              <td className="px-3 py-2 text-[hsl(var(--e-text-secondary))]">{card.detail || "–"}</td>
              <td className="px-3 py-2 text-right">{card.status === "HIRED" ? null : <ERowMenu label={`Move ${card.name}`} items={moveItems(card, onMove)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RolesTable({ roles, careersUrl }: { roles: HubRole[]; careersUrl: string }) {
  return (
    <section aria-labelledby="roles-title" className="min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <h2 id="roles-title" className="text-[0.9375rem] font-semibold">Roles</h2>
        <p className="min-w-0 break-all text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Careers page: {careersUrl.replace(/^https?:\/\//, "")}</p>
      </div>
      {roles.length === 0 ? <p className="px-4 pb-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No roles yet. New role starts one as a draft.</p> : null}
      <div role="region" aria-label="Roles table" tabIndex={0} className="overflow-x-auto max-sm:hidden">
        <table className="w-full min-w-[820px] text-[0.8125rem]">
          <thead className="bg-[hsl(var(--e-surface-raised))] text-left text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <tr>
              <th className="px-4 py-2 font-[550]">Role</th>
              <th className="px-3 py-2 font-[550]">Status</th>
              <th className="px-3 py-2 font-[550]">Applications</th>
              <th className="px-3 py-2 font-[550]">Knowledge test</th>
              <th className="px-3 py-2 font-[550]">Hires become</th>
              <th className="px-3 py-2 font-[550]">Public link</th>
              <th className="px-3 py-2"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--e-border))]">
            {roles.map((role) => (
              <tr key={role.id}>
                <td className="px-4 py-2.5">
                  <p className="font-semibold">{role.title}</p>
                  {role.subtitle ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{role.subtitle}</p> : null}
                </td>
                <td className="px-3 py-2.5"><EPill tone={role.isPublished ? "ok" : "neutral"}>{role.isPublished ? "Accepting" : "Draft"}</EPill></td>
                <td className="e-tnum px-3 py-2.5">{role.applications ? `${role.applications} · ${role.open} open` : "None yet"}</td>
                <td className="px-3 py-2.5">{role.test}</td>
                <td className="px-3 py-2.5">{role.hiresBecomeSet ? role.hiresBecome : <span className="text-[hsl(var(--e-warning))]">Not chosen</span>}</td>
                <td className="px-3 py-2.5">{role.isPublished ? <a className="underline" href={`/apply/${role.slug}`} target="_blank" rel="noreferrer">/apply/{role.slug}</a> : "Not published"}</td>
                <td className="px-3 py-2.5 text-right"><EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/hiring/positions/${role.id}`}>Open</Link></EButton></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[hsl(var(--e-border))] sm:hidden">
        {roles.map((role) => (
          <li key={role.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{role.title}</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{role.isPublished ? "Accepting" : "Draft"} · {role.applications} applications · {role.hiresBecome}</p>
            </div>
            <EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/hiring/positions/${role.id}`}>Open</Link></EButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
