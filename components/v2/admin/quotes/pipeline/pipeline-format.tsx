"use client";

/** Small display helpers for pipeline rows (status and margin pills). */
import * as React from "react";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { PipelineRow } from "@/lib/quotes/pipeline-types";

export function prettify(value: string | null | undefined): string {
  const text = String(value ?? "").replace(/_/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const STATUS_TONE: Record<string, EPillTone> = {
  NEW: "gold",
  CONTACTED: "neutral",
  QUOTED: "info",
  LOST: "bad",
  DRAFT: "neutral",
  SENT: "info",
  ACCEPTED: "ok",
  DECLINED: "bad",
  CONVERTED: "ok",
};

export function StatusPill({ row }: { row: Pick<PipelineRow, "status"> }) {
  return <EPill tone={STATUS_TONE[row.status] ?? "neutral"}>{prettify(row.status)}</EPill>;
}

export function MarginPill({ row }: { row: Pick<PipelineRow, "kind" | "margin" | "belowFloor"> }) {
  if (row.kind === "lead") return null;
  if (row.margin == null) return <EPill>Unknown</EPill>;
  const pct = `${(row.margin * 100).toFixed(0)}%`;
  return <EPill tone={row.belowFloor ? "warn" : "ok"}>{row.belowFloor ? `${pct} · under floor` : pct}</EPill>;
}
