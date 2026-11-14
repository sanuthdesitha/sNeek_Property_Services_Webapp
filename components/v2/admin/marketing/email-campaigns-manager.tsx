"use client";

/**
 * Email campaigns tab (board "Marketing", 2026-11-16): the campaign list with
 * the email service's figures, then the who / what / when editor for the
 * chosen row or a new campaign. Delivered, opened, clicked and bounced come
 * from the email service's reports; until it reports, the cell says "not
 * recorded", never 0. A campaign with failed sends is banded and offers
 * "Retry the N", which sends only to those addresses.
 */
import * as React from "react";
import { Plus, Search } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { toneNoticeClass, toneRowCellClass } from "@/components/v2/ui/tone-band";
import { EInput } from "@/components/v2/admin/estate-kit";
import { formatOrgDateTime } from "@/lib/public-site/zoned-time";
import type { EmailCampaignRow, SegmentOption } from "@/lib/marketing/workspace-types";
import type { BrandChrome, PickableAsset } from "@/components/v2/admin/marketing/email-block-editor";
import { CampaignEditor, audienceFormFrom, audienceLabel, type SegmentsState } from "./campaign-editor";

type Toast = { title: string; description?: string; tone: "success" | "danger" };

type Filter = "all" | "draft" | "scheduled" | "sent" | "failed";

const NEW_KEY = "new";

export function campaignStateOf(row: EmailCampaignRow): Exclude<Filter, "all"> | "sending" {
  if (row.status === "scheduled") return "scheduled";
  if (row.status === "sent") return "sent";
  if (row.status === "failed") return "failed";
  if (row.status === "sending") return "sending";
  return "draft";
}

const STATE_PILL: Record<ReturnType<typeof campaignStateOf>, { label: string; tone: EPillTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  sending: { label: "Sending", tone: "warn" },
  sent: { label: "Sent", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
};

function normaliseRow(row: Partial<EmailCampaignRow> & { id: string }): EmailCampaignRow {
  return {
    name: "",
    subject: "",
    htmlBody: "",
    audience: null,
    status: "draft",
    scheduledAt: null,
    sentAt: null,
    recipientCount: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sends: { sent: 0, failed: 0, skipped: 0 },
    report: null,
    ...row,
  };
}

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function writeOpen(value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set("open", value);
  else url.searchParams.delete("open");
  window.history.replaceState(window.history.state, "", url.toString());
}

/** A figure from the email service; "not recorded" until it reports (never 0). */
function ReportCell({ row, value }: { row: EmailCampaignRow; value: (report: NonNullable<EmailCampaignRow["report"]>) => number }) {
  const state = campaignStateOf(row);
  if (state === "draft" || state === "scheduled") return <span className="text-[hsl(var(--e-muted-foreground))]">–</span>;
  if (!row.report) return <span className="italic text-[hsl(var(--e-muted-foreground))]">not recorded</span>;
  return <span className="tabular-nums">{value(row.report).toLocaleString("en-AU")}</span>;
}

export function EmailCampaignsManager({
  initialCampaigns,
  onToast,
  assets = [],
  brand,
  timeZone = "Australia/Sydney",
  externalDraft = null,
  onExternalDraftConsumed,
  onOpenTemplates,
}: {
  initialCampaigns: EmailCampaignRow[];
  onToast: (t: Toast) => void;
  assets?: PickableAsset[];
  brand: BrandChrome;
  timeZone?: string;
  /** A draft made in the template gallery — opened for editing on arrival. */
  externalDraft?: (Partial<EmailCampaignRow> & { id: string }) | null;
  onExternalDraftConsumed?: () => void;
  onOpenTemplates?: () => void;
}) {
  const [campaigns, setCampaigns] = React.useState<EmailCampaignRow[]>(initialCampaigns);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [segments, setSegments] = React.useState<SegmentsState>({ status: "loading" });
  const [retryRow, setRetryRow] = React.useState<EmailCampaignRow | null>(null);
  const [retrying, setRetrying] = React.useState(false);
  const [retryError, setRetryError] = React.useState<string | null>(null);
  const editorRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    setOpenKey(readParam("open"));
  }, []);

  // Audience sizes for the picker, counted on the server exactly as the sender would.
  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/marketing/segments", { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !Array.isArray(body?.segments)) setSegments({ status: "error" });
        else setSegments({ status: "ready", segments: body.segments as SegmentOption[] });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSegments({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (!externalDraft) return;
    const row = normaliseRow(externalDraft);
    setCampaigns((current) => (current.some((item) => item.id === row.id) ? current : [row, ...current]));
    open(row.id);
    onExternalDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalDraft?.id]);

  function open(key: string | null) {
    setOpenKey(key);
    writeOpen(key);
    if (key) window.setTimeout(() => editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
  }

  const counts = React.useMemo(() => {
    const result: Record<Filter, number> = { all: campaigns.length, draft: 0, scheduled: 0, sent: 0, failed: 0 };
    for (const row of campaigns) {
      const state = campaignStateOf(row);
      if (state !== "sending") result[state] += 1;
    }
    return result;
  }, [campaigns]);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns.filter((row) => {
      if (filter !== "all" && campaignStateOf(row) !== filter) return false;
      if (!q) return true;
      return `${row.name} ${row.subject}`.toLowerCase().includes(q);
    });
  }, [campaigns, query, filter]);

  const openRow = openKey && openKey !== NEW_KEY ? campaigns.find((row) => row.id === openKey) ?? null : null;
  const editorOpen = openKey === NEW_KEY || Boolean(openRow);

  function upsert(row: EmailCampaignRow) {
    setCampaigns((current) => (current.some((item) => item.id === row.id) ? current.map((item) => (item.id === row.id ? row : item)) : [row, ...current]));
  }

  async function retry() {
    if (!retryRow || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/admin/email-campaigns/${retryRow.id}/retry`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "The failed sends were not retried.");
      const previous = retryRow.sends ?? { sent: 0, failed: 0, skipped: 0 };
      const retried = Number(body.retried ?? previous.failed);
      const sent = Number(body.sent ?? 0);
      const failed = Number(body.failed ?? 0);
      const sends = { sent: previous.sent + sent, failed, skipped: previous.skipped + Math.max(0, retried - sent - failed) };
      upsert({ ...retryRow, sends, status: failed > 0 ? "failed" : "sent", sentAt: failed > 0 ? null : new Date().toISOString(), recipientCount: sends.sent });
      onToast({
        title: failed > 0 ? "Some emails failed again" : "Failed emails retried",
        description: `${sent} handed to the email service, ${failed} failed, ${Math.max(0, retried - sent - failed)} skipped.`,
        tone: failed > 0 ? "danger" : "success",
      });
      setRetryRow(null);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "The failed sends were not retried.");
    } finally {
      setRetrying(false);
    }
  }

  function stateLine(row: EmailCampaignRow): string {
    const state = campaignStateOf(row);
    if (state === "draft") return `edited ${formatOrgDateTime(row.updatedAt, timeZone)}`;
    if (state === "scheduled") return formatOrgDateTime(row.scheduledAt, timeZone);
    if (state === "sending") return "Sending now";
    if (state === "failed") return row.sends ? `${row.sends.sent} sent, ${row.sends.failed} failed` : "Failed; counts not recorded";
    return formatOrgDateTime(row.sentAt, timeZone);
  }

  const sentTo = (row: EmailCampaignRow) => {
    const state = campaignStateOf(row);
    if (state === "draft" || state === "scheduled") return <span className="text-[hsl(var(--e-muted-foreground))]">–</span>;
    const value = row.sends ? row.sends.sent + row.sends.failed : row.recipientCount;
    return value === null ? <span className="italic text-[hsl(var(--e-muted-foreground))]">not recorded</span> : <span className="tabular-nums">{value.toLocaleString("en-AU")}</span>;
  };

  const retryButton = (row: EmailCampaignRow) =>
    campaignStateOf(row) === "failed" && row.sends && row.sends.failed > 0 ? (
      <EButton
        variant="outline"
        size="sm"
        className="mt-1"
        onClick={(event) => {
          event.stopPropagation();
          setRetryError(null);
          setRetryRow(row);
        }}
      >
        Retry the {row.sends.failed}
      </EButton>
    ) : null;

  return (
    <div className="space-y-5">
      <ECard className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative w-full sm:w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" aria-hidden />
            <EInput aria-label="Search campaigns" className="pl-9 max-sm:text-[1rem]" placeholder="Search campaigns" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <EFilterChips
            label="Campaign state"
            active={filter}
            onChange={setFilter}
            phoneLayout="carousel"
            chips={[
              { key: "all", label: "All", count: counts.all },
              { key: "draft", label: "Drafts", count: counts.draft },
              { key: "scheduled", label: "Scheduled", count: counts.scheduled },
              { key: "sent", label: "Sent", count: counts.sent },
              ...(counts.failed > 0 ? [{ key: "failed" as const, label: "Failed", count: counts.failed }] : []),
            ]}
          />
          <EButton size="sm" className="ml-auto max-sm:hidden" onClick={() => open(NEW_KEY)}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New email campaign
          </EButton>
        </div>

        {campaigns.length === 0 ? (
          <p className="border-t border-[hsl(var(--e-border))] px-4 py-10 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            No email campaigns yet. Start one, or make one from a template.
          </p>
        ) : visible.length === 0 ? (
          <p className="border-t border-[hsl(var(--e-border))] px-4 py-10 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No campaigns match this search or state.</p>
        ) : (
          <>
            <div role="region" aria-label="Email campaigns" className="overflow-x-auto border-t border-[hsl(var(--e-border))] max-sm:hidden">
              <table className="w-full min-w-[860px] text-left text-[0.8125rem]">
                <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-[600]">Campaign</th>
                    <th scope="col" className="px-3 py-2 font-[600]">Audience</th>
                    <th scope="col" className="px-3 py-2 font-[600]">State</th>
                    <th scope="col" className="px-3 py-2 text-right font-[600]">Sent to</th>
                    <th scope="col" className="px-3 py-2 text-right font-[600]">Delivered</th>
                    <th scope="col" className="px-3 py-2 text-right font-[600]">Opened</th>
                    <th scope="col" className="px-3 py-2 text-right font-[600]">Clicked</th>
                    <th scope="col" className="px-3 py-2 text-right font-[600]">Bounced</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const state = campaignStateOf(row);
                    const pill = STATE_PILL[state];
                    const failed = state === "failed";
                    const partly = failed && Boolean(row.sends && row.sends.sent > 0);
                    return (
                      <tr key={row.id} onClick={() => open(row.id)} className={`cursor-pointer border-t border-[hsl(var(--e-border))] ${row.id === openKey ? "bg-[hsl(var(--e-primary-soft))]" : "hover:bg-[hsl(var(--e-muted))]"}`}>
                        <td className={`px-3 py-2.5 ${failed ? toneRowCellClass("problem") : ""}`}>
                          <button
                            type="button"
                            className="text-left font-[600] [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
                            onClick={(event) => {
                              event.stopPropagation();
                              open(row.id);
                            }}
                          >
                            {row.name}
                          </button>
                          {failed ? <span className="ml-1.5 whitespace-nowrap rounded-full bg-[hsl(var(--e-surface))] px-1.5 text-[0.6875rem] font-[600] text-[hsl(var(--e-band-problem-fg))]">{partly ? "Partly failed" : "Failed"}</span> : null}
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">&ldquo;{row.subject}&rdquo;</p>
                        </td>
                        <td className="px-3 py-2.5 text-[0.75rem]">{audienceLabel(audienceFormFrom(row.audience))}</td>
                        <td className="px-3 py-2.5">
                          <EPill tone={pill.tone}>{pill.label}</EPill>
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{stateLine(row)}</p>
                          {retryButton(row)}
                        </td>
                        <td className="px-3 py-2.5 text-right">{sentTo(row)}</td>
                        <td className="px-3 py-2.5 text-right"><ReportCell row={row} value={(report) => report.delivered} /></td>
                        <td className="px-3 py-2.5 text-right"><ReportCell row={row} value={(report) => report.opened} /></td>
                        <td className="px-3 py-2.5 text-right"><ReportCell row={row} value={(report) => report.clicked} /></td>
                        <td className="px-3 py-2.5 text-right"><ReportCell row={row} value={(report) => report.bounced} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul aria-label="Email campaigns" className="divide-y divide-[hsl(var(--e-border))] border-t border-[hsl(var(--e-border))] sm:hidden">
              {visible.map((row) => {
                const state = campaignStateOf(row);
                const pill = STATE_PILL[state];
                return (
                  <li key={row.id} className={`space-y-1 px-4 py-3 ${state === "failed" ? toneRowCellClass("problem") : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="min-h-11 text-left font-[600] [overflow-wrap:anywhere]" onClick={() => open(row.id)}>
                        {row.name}
                      </button>
                      <EPill tone={pill.tone}>{pill.label}</EPill>
                    </div>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {audienceLabel(audienceFormFrom(row.audience))} · {stateLine(row)}
                    </p>
                    {state === "sent" || state === "failed" ? (
                      <p className="text-[0.75rem]">
                        Sent to {sentTo(row)} · delivered <ReportCell row={row} value={(report) => report.delivered} /> · opened <ReportCell row={row} value={(report) => report.opened} />
                      </p>
                    ) : null}
                    {retryButton(row)}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="border-t border-[hsl(var(--e-border))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Delivered, opened, clicked and bounced come from the email service&apos;s reports. Until it reports, the cell says &ldquo;not recorded&rdquo;, never 0. Unsubscribed and bounce-list addresses are skipped and counted on the campaign.
        </p>
      </ECard>

      <section ref={editorRef} aria-labelledby="campaign-editor-heading" className="scroll-mt-4 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="campaign-editor-heading" className="e-serif text-[1.375rem] leading-tight">
            {openKey === NEW_KEY ? "New email campaign" : openRow ? openRow.name : "Email campaign editor"}
          </h2>
          <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Who, what, when. Opens from a row or New email campaign.</span>
          {editorOpen ? (
            <EButton variant="ghost" size="sm" className="ml-auto" onClick={() => open(null)}>
              Close editor
            </EButton>
          ) : null}
        </div>
        {editorOpen ? (
          <CampaignEditor
            key={openKey ?? "none"}
            campaign={openRow}
            segments={segments}
            assets={assets}
            brand={brand}
            timeZone={timeZone}
            onOpenTemplates={() => onOpenTemplates?.()}
            onSaved={(row, message) => {
              upsert(row);
              if (openKey === NEW_KEY) open(row.id);
              onToast({ title: message, tone: "success" });
            }}
            onSent={(row, result) => {
              const failed = result.failed > 0;
              upsert({
                ...row,
                status: failed ? "failed" : "sent",
                sentAt: failed ? null : new Date().toISOString(),
                recipientCount: result.sent,
                sends: { sent: result.sent, failed: result.failed, skipped: result.suppressed },
              });
              onToast({
                title: failed ? "Campaign has failed sends" : "Campaign handed to the email service",
                description: `${result.sent} sent, ${result.failed} failed, ${result.suppressed} skipped. Handed over is not delivered; the figures fill in as the email service reports.`,
                tone: failed ? "danger" : "success",
              });
            }}
            onDeleted={(id) => {
              setCampaigns((current) => current.filter((row) => row.id !== id));
              open(null);
              onToast({ title: "Campaign deleted", tone: "success" });
            }}
          />
        ) : (
          <p className={`rounded-[var(--e-radius)] px-3 py-3 text-[0.8125rem] ${toneNoticeClass("info")}`}>
            Choose a campaign above, or start a new one. The audience count, the skipped addresses and the send time show together before anything is scheduled.
          </p>
        )}
      </section>

      <EPhoneActionBar
        label="Campaign actions"
        hidden={editorOpen}
        primary={
          <EButton onClick={() => open(NEW_KEY)}>
            <Plus className="h-4 w-4" aria-hidden /> New email campaign
          </EButton>
        }
      />

      <EConfirmDialog
        open={Boolean(retryRow)}
        onClose={() => setRetryRow(null)}
        tier="ordinary"
        title={`Retry the ${retryRow?.sends?.failed ?? 0} failed emails?`}
        description={`Only those ${retryRow?.sends?.failed ?? 0} people are sent "${retryRow?.name ?? ""}" again, one email each, if they are still in the audience and have not unsubscribed. Nobody already sent to gets it twice.`}
        confirmLabel={`Retry the ${retryRow?.sends?.failed ?? 0}`}
        busy={retrying}
        error={retryError ?? undefined}
        onConfirm={() => retry()}
      />
    </div>
  );
}
