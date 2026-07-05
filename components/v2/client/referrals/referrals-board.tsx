"use client";

/**
 * Estate referrals & rewards board — same endpoints as the legacy RewardsPage:
 *   GET  /api/client/referrals  → { summary, referrals[] }
 *   POST /api/client/referrals  { refereeEmail } → { shareUrl, ... }
 * Styled entirely through the Estate token scope (`--e-*`). No v1 UI imports.
 */
import { useEffect, useState } from "react";
import { Copy, Gift, Loader2, Send, Check } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EEyebrow,
  EStatCard,
  EThread,
} from "@/components/v2/ui/primitives";
import { EInput, EField } from "@/components/v2/admin/estate-kit";
import { EInlineNotice } from "@/components/v2/client/fields";
import { toast } from "@/hooks/use-toast";

type RewardsPayload = {
  summary: {
    points: number;
    creditValue: number;
    convertedReferrals: number;
    pendingReferrals: number;
  };
  referrals: Array<{
    id: string;
    code: string;
    refereeEmail: string;
    status: string;
    expiresAt: string | null;
    refereeDiscountPercent: number;
    referrerRewardPoints: number;
  }>;
};

const STATUS_TONE: Record<string, "success" | "gold" | "danger" | "neutral"> = {
  CONVERTED: "success",
  COMPLETED: "success",
  PENDING: "gold",
  SENT: "gold",
  EXPIRED: "danger",
  DECLINED: "danger",
  CANCELLED: "neutral",
};

function statusTone(status: string) {
  return STATUS_TONE[status.toUpperCase()] ?? "neutral";
}

export function ReferralsBoard() {
  const [payload, setPayload] = useState<RewardsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [refereeEmail, setRefereeEmail] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/client/referrals", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error ?? "Could not load rewards.");
    }
    setPayload(body);
  }

  useEffect(() => {
    load()
      .catch((error: any) => setLoadError(error?.message ?? "Could not load rewards."))
      .finally(() => setLoading(false));
  }, []);

  async function createInvite() {
    if (!refereeEmail.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/client/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refereeEmail }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error ?? "Could not create referral.");
      }
      setRefereeEmail("");
      await load();
      toast({ title: "Referral invite created", description: body.shareUrl || "Share the code with your friend." });
    } catch (error: any) {
      setCreateError(error?.message ?? "Could not create referral.");
    } finally {
      setCreating(false);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast({ title: "Referral code copied" });
      window.setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1800);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  const s = payload?.summary;

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EStatCard label="Points balance" value={<span className="e-tnum">{s?.points ?? 0}</span>} icon={<Gift />} />
        <EStatCard label="Credit value" value={<span className="e-tnum">${(s?.creditValue ?? 0).toFixed(2)}</span>} />
        <EStatCard label="Pending referrals" value={<span className="e-tnum">{s?.pendingReferrals ?? 0}</span>} />
        <EStatCard label="Converted referrals" value={<span className="e-tnum">{s?.convertedReferrals ?? 0}</span>} />
      </section>

      {/* Invite a friend */}
      <ECard>
        <ECardBody className="space-y-4 p-6">
          <div>
            <EEyebrow>Invite a friend</EEyebrow>
            <h2 className="e-display-sm mt-1">Share your referral</h2>
            <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              Create a referral code for a friend. They receive a first-service discount and you earn points once they
              convert.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <EField label="Friend's email" className="flex-1">
              <EInput
                type="email"
                value={refereeEmail}
                onChange={(event) => setRefereeEmail(event.target.value)}
                placeholder="friend@example.com"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && refereeEmail.trim() && !creating) void createInvite();
                }}
              />
            </EField>
            <EButton onClick={() => void createInvite()} disabled={creating || !refereeEmail.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Create referral invite
            </EButton>
          </div>
          {createError ? <EInlineNotice tone="danger">{createError}</EInlineNotice> : null}
        </ECardBody>
      </ECard>

      {/* Referral history */}
      <ECard>
        <ECardBody className="space-y-4 p-6">
          <div>
            <EEyebrow>Referral history</EEyebrow>
            <h2 className="e-display-sm mt-1">Recent invites</h2>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading rewards…
            </div>
          ) : loadError ? (
            <EInlineNotice tone="danger">{loadError}</EInlineNotice>
          ) : payload?.referrals?.length ? (
            <div className="space-y-3">
              {payload.referrals.map((row) => (
                <div
                  key={row.id}
                  className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-[550] text-[hsl(var(--e-foreground))]">{row.refereeEmail}</p>
                      <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {row.refereeDiscountPercent}% discount · {row.referrerRewardPoints} points
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <EBadge tone={statusTone(row.status)} soft>
                        {row.status.replace(/_/g, " ")}
                      </EBadge>
                      <span className="e-tnum rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-2.5 py-0.5 text-[0.75rem] font-[550] tracking-[0.06em] text-[hsl(var(--e-gold-ink))]">
                        {row.code}
                      </span>
                      <EButton size="sm" variant="outline" onClick={() => void copyCode(row.code)}>
                        {copiedCode === row.code ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedCode === row.code ? "Copied" : "Copy"}
                      </EButton>
                    </div>
                  </div>
                  {row.expiresAt ? (
                    <>
                      <EThread className="my-3" />
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        Expires {new Date(row.expiresAt).toLocaleDateString("en-AU")}
                      </p>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EEmptyState
              eyebrow="Nothing yet"
              title="No referral invites"
              description="Create your first referral invite above and share it with a friend."
            />
          )}
        </ECardBody>
      </ECard>

      {/* Loyalty rule */}
      <ECard variant="ceremony">
        <ECardBody className="flex items-start gap-3 p-5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
            <Gift className="h-4 w-4" />
          </span>
          <div>
            <p className="font-[550] text-[hsl(var(--e-foreground))]">Loyalty rule</p>
            <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              Points are awarded from completed, billed work. 1,000 points equals $10 of credit value toward future
              services.
            </p>
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
