"use client";

import { useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";

export function RatingForm({
  jobId,
  token,
  valid,
  initialScore,
  initialComment,
}: {
  jobId: string;
  token: string;
  valid: boolean;
  initialScore: number | null;
  initialComment: string;
}) {
  const [score, setScore] = useState<number>(initialScore ?? 5);
  const [comment, setComment] = useState(initialComment);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(Boolean(initialScore));
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, token, score, comment }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save your rating.");
      setSaved(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not save your rating.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {!valid && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          This rating link is invalid or has expired.
        </div>
      )}

      <div>
        <p className="mb-3 text-sm font-medium">How did we do?</p>
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              disabled={!valid || submitting}
              onClick={() => setScore(value)}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-full border transition-colors ${
                score >= value
                  ? "border-amber-300 bg-amber-50 text-amber-500"
                  : "border-border bg-background text-muted-foreground"
              } ${!valid || submitting ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <Star className={`h-5 w-5 ${score >= value ? "fill-current" : ""}`} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Anything we should know?</label>
        <textarea
          rows={5}
          value={comment}
          disabled={!valid || submitting}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional feedback for the team"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Your feedback has been saved. Thank you.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center rounded-lg border border-input bg-background px-4 py-2 text-sm hover:bg-muted"
        >
          Back to website
        </Link>
        <button
          onClick={submit}
          disabled={!valid || submitting}
          className="rounded-lg bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
        >
          {submitting ? "Saving..." : saved ? "Update rating" : "Submit rating"}
        </button>
      </div>
    </div>
  );
}