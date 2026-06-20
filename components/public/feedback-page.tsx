"use client";

import Link from "next/link";
import { useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function FeedbackPage({
  token,
  valid,
  propertyName,
  serviceLabel,
  scheduledDateLabel,
  initialRating,
  initialComment,
  initialCleanliness = null,
  initialCommunication = null,
  initialValue = null,
  initialRecommend = null,
}: {
  token: string;
  valid: boolean;
  propertyName: string;
  serviceLabel: string;
  scheduledDateLabel: string;
  initialRating: number | null;
  initialComment: string;
  initialCleanliness?: number | null;
  initialCommunication?: number | null;
  initialValue?: number | null;
  initialRecommend?: boolean | null;
}) {
  const [rating, setRating] = useState<number>(initialRating ?? 5);
  const [cleanliness, setCleanliness] = useState<number | null>(initialCleanliness);
  const [communication, setCommunication] = useState<number | null>(initialCommunication);
  const [value, setValue] = useState<number | null>(initialValue);
  const [recommend, setRecommend] = useState<boolean | null>(initialRecommend);
  const [comment, setComment] = useState(initialComment);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(Boolean(initialRating || initialComment));
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          rating,
          cleanlinessRating: cleanliness,
          communicationRating: communication,
          valueRating: value,
          wouldRecommend: recommend,
          comment,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save your feedback.");
      setSaved(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not save your feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4 py-10">
      <Card className="w-full rounded-[2rem] border-white/70 dark:border-white/10 bg-white/85 dark:bg-white/5 shadow-[0_24px_80px_-36px_rgba(22,63,70,0.38)]">
        <CardHeader className="space-y-3 text-center">
          <CardTitle className="text-3xl">Share your feedback</CardTitle>
          <CardDescription className="text-base">
            {propertyName} | {serviceLabel} | {scheduledDateLabel}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!valid ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              This feedback link is invalid or has expired.
            </div>
          ) : null}

          <div className="space-y-3">
            <p className="text-sm font-medium">Overall rating</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={!valid || submitting}
                  className={cn(
                    "inline-flex h-12 w-12 items-center justify-center rounded-full border transition-colors",
                    rating >= value ? "border-amber-300 bg-amber-50 text-amber-500" : "border-border bg-background text-muted-foreground",
                    (!valid || submitting) && "cursor-not-allowed opacity-60"
                  )}
                  onClick={() => setRating(value)}
                >
                  <Star className={cn("h-5 w-5", rating >= value && "fill-current")} />
                </button>
              ))}
            </div>
          </div>

          {/* Client-perspective aspects — this is a satisfaction review, not a QA inspection. */}
          {([
            ["Cleanliness", cleanliness, setCleanliness] as const,
            ["Communication", communication, setCommunication] as const,
            ["Value for money", value, setValue] as const,
          ]).map(([label, val, setVal]) => (
            <div key={label} className="space-y-2">
              <p className="text-sm font-medium">{label}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={!valid || submitting}
                    className={cn(
                      "inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
                      (val ?? 0) >= v ? "border-amber-300 bg-amber-50 text-amber-500" : "border-border bg-background text-muted-foreground",
                      (!valid || submitting) && "cursor-not-allowed opacity-60"
                    )}
                    onClick={() => setVal(v)}
                  >
                    <Star className={cn("h-4 w-4", (val ?? 0) >= v && "fill-current")} />
                  </button>
                ))}
                {val != null ? (
                  <button type="button" className="ml-1 text-xs text-muted-foreground underline" onClick={() => setVal(null)} disabled={!valid || submitting}>
                    clear
                  </button>
                ) : null}
              </div>
            </div>
          ))}

          <div className="space-y-2">
            <p className="text-sm font-medium">Would you recommend us?</p>
            <div className="flex gap-2">
              {([["Yes", true] as const, ["No", false] as const]).map(([label, v]) => (
                <button
                  key={label}
                  type="button"
                  disabled={!valid || submitting}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm transition-colors",
                    recommend === v ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground",
                    (!valid || submitting) && "cursor-not-allowed opacity-60"
                  )}
                  onClick={() => setRecommend(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Comments</p>
            <Textarea
              rows={6}
              value={comment}
              disabled={!valid || submitting}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Tell us what went well or what we should improve"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {saved ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Your feedback has been saved. Thank you.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button asChild variant="outline">
              <Link href="/">Back to website</Link>
            </Button>
            <Button onClick={submit} disabled={!valid || submitting}>
              {submitting ? "Saving..." : saved ? "Update feedback" : "Submit feedback"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
