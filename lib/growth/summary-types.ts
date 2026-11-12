/** Shapes of the Growth page's figures (plain module). Null block = not shown to this viewer. */
import type { PipelineCounts } from "@/lib/quotes/pipeline-types";

export type GrowthSummary = {
  monthStart: string;
  leads: {
    counts: PipelineCounts;
    newThisMonth: number;
    newLastMonth: number;
    quotesThisMonth: number;
    wonThisMonth: number;
    next: Array<{ name: string; detail: string; status: string; label: string; href: string | null }>;
  } | null;
  campaigns: {
    sentThisMonth: number;
    /** Null when any sent campaign has no recorded recipient count. */
    recipientsThisMonth: number | null;
    /** Null until the email provider has reported an open. */
    opensThisMonth: number | null;
    recent: Array<{ id: string; name: string; channel: string; status: string; sentAt: string | null; recipients: number | null }>;
  } | null;
  website: { publishedPosts: number; drafts: Array<{ id: string; title: string; updatedAt: string }> } | null;
  hiring: {
    applied: number;
    screening: number;
    interview: number;
    offer: number;
    positions: Array<{ id: string; title: string; published: boolean; applications: number }>;
  } | null;
};
