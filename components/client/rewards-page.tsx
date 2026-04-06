"use client";

import { useEffect, useState } from "react";
import { Copy, Gift, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

export function RewardsPage() {
  const [payload, setPayload] = useState<RewardsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refereeEmail, setRefereeEmail] = useState("");

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
      .catch((error: any) => {
        toast({
          title: "Load failed",
          description: error?.message ?? "Could not load rewards.",
          variant: "destructive",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  async function createInvite() {
    if (!refereeEmail.trim()) return;
    setCreating(true);
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
      toast({
        title: "Referral invite created",
        description: body.shareUrl || "Share the code with your friend.",
      });
    } catch (error: any) {
      toast({
        title: "Invite failed",
        description: error?.message ?? "Could not create referral.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast({ title: "Referral code copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Rewards & referrals</h1>
        <p className="text-sm text-muted-foreground">
          Track loyalty points, convert them into credit value, and invite friends to sNeek.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Points balance</p>
            <p className="text-2xl font-semibold">{payload?.summary.points ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Credit value</p>
            <p className="text-2xl font-semibold">${(payload?.summary.creditValue ?? 0).toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pending referrals</p>
            <p className="text-2xl font-semibold">{payload?.summary.pendingReferrals ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Converted referrals</p>
            <p className="text-2xl font-semibold">{payload?.summary.convertedReferrals ?? 0}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Invite a friend</CardTitle>
          <CardDescription>
            Create a referral code for a friend. They get a first-service discount and you earn points once they convert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="email"
            value={refereeEmail}
            onChange={(event) => setRefereeEmail(event.target.value)}
            placeholder="friend@example.com"
          />
          <div className="flex justify-end">
            <Button onClick={createInvite} disabled={creating || !refereeEmail.trim()}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Create referral invite
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Referral history</CardTitle>
          <CardDescription>Recent invites and their current status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading rewards...
            </div>
          ) : payload?.referrals?.length ? (
            payload.referrals.map((row) => (
              <div key={row.id} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{row.refereeEmail}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.status} • {row.refereeDiscountPercent}% discount • {row.referrerRewardPoints} points
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border px-2 py-1 text-xs font-medium">{row.code}</span>
                    <Button size="sm" variant="outline" onClick={() => copyCode(row.code)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy
                    </Button>
                  </div>
                </div>
                {row.expiresAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Expires {new Date(row.expiresAt).toLocaleDateString("en-AU")}
                  </p>
                ) : null}
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No referral invites created yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/6">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-primary">
          <Gift className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Loyalty rule</p>
            <p className="mt-1 text-primary/90">
              Points are awarded from completed, billed work. 1000 points equals $10 credit value for future services.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
