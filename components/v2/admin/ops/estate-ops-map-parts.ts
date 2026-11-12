/**
 * Pure helpers for the Live ops map: staleness tiers, labels and the HTML of
 * the Google Maps info windows (escaped). Moved unchanged from estate-ops-map.
 */
import { formatRelativeAgo } from "@/lib/ops/live-status";
import type { LivePing } from "@/lib/ops/live-feed-types";

export type OpsMapProperty = {
  /** Present when the pin represents an active job (deep-links to the job). */
  jobId?: string | null;
  name: string;
  suburb?: string | null;
  lat: number;
  lng: number;
  status?: string | null;
};

type RawPing = LivePing;

// ── Staleness (seconds since last ping → colour tier) ────────────────────
export const STALE_TIERS = [
  { maxSeconds: 120, color: "#3f9b6d", label: "Fresh (< 2 min)" },
  { maxSeconds: 600, color: "#c99a2e", label: "Aging (< 10 min)" },
  { maxSeconds: Infinity, color: "#b4472e", label: "Stale (10 min +)" },
] as const;

export function staleTier(timestamp: string | null | undefined) {
  if (!timestamp) return STALE_TIERS[STALE_TIERS.length - 1];
  const ms = new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return STALE_TIERS[STALE_TIERS.length - 1];
  const s = (Date.now() - ms) / 1000;
  return STALE_TIERS.find((t) => s < t.maxSeconds) ?? STALE_TIERS[STALE_TIERS.length - 1];
}

export function hasPosition(ping: RawPing): boolean {
  return typeof ping.lat === "number" && typeof ping.lng === "number";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATUS_FALLBACK_LABEL: Record<string, string> = {
  ON_SITE: "On site",
  EN_ROUTE: "En route",
  OFF_SITE: "Clocked in · off site",
  NO_SIGNAL: "Clocked in · no signal",
  PAUSED: "Paused",
  LEFT_SITE: "Left site",
  IDLE: "Idle",
};

export function liveStatusLabel(ping: RawPing): string {
  return ping.liveLabel ?? STATUS_FALLBACK_LABEL[ping.liveStatus ?? "IDLE"] ?? "Idle";
}

export function liveStatusTone(ping: RawPing): "info" | "success" | "neutral" | "warning" | "danger" | "gold" {
  switch (ping.liveStatus) {
    case "EN_ROUTE":
      return "info";
    case "ON_SITE":
      return "success";
    case "OFF_SITE":
      return "warning";
    case "NO_SIGNAL":
    case "LEFT_SITE":
      return "danger";
    case "PAUSED":
      return "gold";
    default:
      return "neutral";
  }
}

export function formatElapsed(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function elapsedFromStart(startedAt: string, fallbackMinutes: number): number {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return fallbackMinutes;
  return Math.max(0, Math.round((Date.now() - started) / 60_000));
}

export function formatClockIn(startedAt: string): string {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatEta(etaMinutes: number | null): string | null {
  if (etaMinutes == null) return null;
  if (etaMinutes <= 1) return "Arriving now";
  const arrival = new Date(Date.now() + etaMinutes * 60_000);
  const time = arrival.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
  return `ETA ${Math.round(etaMinutes)} min · ~${time}`;
}

// Shared relative-age formatting (same helper the server derivation uses).
export const relativePing = (iso: string | null | undefined) => formatRelativeAgo(iso ?? null);

export function cleanerName(ping: RawPing): string {
  return ping.user?.name ?? ping.userId.slice(0, 8);
}

export function cleanerTooltip(ping: RawPing): string {
  const parts = [`${cleanerName(ping)} — ${liveStatusLabel(ping)}`];
  if (ping.activeJob) {
    parts.push(
      `${ping.activeJob.propertyName}${ping.activeJob.jobNumber ? ` (#${ping.activeJob.jobNumber})` : ""}`,
    );
    const eta = formatEta(ping.activeJob.etaMinutes);
    if (eta && ping.liveStatus === "EN_ROUTE") parts.push(eta);
  }
  if (ping.timer) {
    parts.push(
      `Clocked in ${formatClockIn(ping.timer.startedAt)} · elapsed ${formatElapsed(elapsedFromStart(ping.timer.startedAt, ping.timer.elapsedMinutes))}`,
    );
  }
  if (ping.positionSource === "property") {
    parts.push("No GPS yet — shown at job address");
  } else {
    parts.push(`Last ping ${relativePing(ping.timestamp)}`);
  }
  return parts.join("\n");
}

export function cleanerInfoHtml(ping: RawPing): string {
  const name = escapeHtml(cleanerName(ping));
  const rows: string[] = [
    `<div style="font:600 13px system-ui;color:#2a241d">${name} <span style="font-weight:500;color:#7a6f2e">· ${liveStatusLabel(ping)}</span></div>`,
  ];
  if (ping.activeJob) {
    const jobLabel = `${escapeHtml(ping.activeJob.propertyName)}${ping.activeJob.jobNumber ? ` <span style="color:#8a7f70">#${escapeHtml(String(ping.activeJob.jobNumber))}</span>` : ""}`;
    rows.push(
      `<div style="font:400 12px system-ui;color:#4a4238;margin-top:4px">${jobLabel} · ${escapeHtml(ping.activeJob.status.replace(/_/g, " ").toLowerCase())}</div>`,
    );
    const eta = formatEta(ping.activeJob.etaMinutes);
    if (eta && ping.liveStatus === "EN_ROUTE") {
      rows.push(`<div style="font:500 12px system-ui;color:#7a6f2e;margin-top:2px">${escapeHtml(eta)}</div>`);
    }
    rows.push(
      `<a href="/v2/admin/jobs/${encodeURIComponent(ping.activeJob.id)}" style="font:500 12px system-ui;color:#7a6f2e">Open job →</a>`,
    );
  }
  if (ping.timer) {
    rows.push(
      `<div style="font:400 12px system-ui;color:#4a4238;margin-top:4px">Clocked in ${formatClockIn(ping.timer.startedAt)} · elapsed ${formatElapsed(elapsedFromStart(ping.timer.startedAt, ping.timer.elapsedMinutes))}</div>`,
    );
  }
  if (!ping.activeJob && !ping.timer) {
    rows.push(`<div style="font:400 12px system-ui;color:#8a7f70;margin-top:4px">No active job or running timer.</div>`);
  }
  if (ping.positionSource === "property") {
    rows.push(
      `<div style="font:500 11px system-ui;color:#b4472e;margin-top:4px">No GPS yet — shown at job address</div>`,
    );
  } else {
    rows.push(
      `<div style="font:400 11px system-ui;color:#a39a8a;margin-top:4px">Last ping ${escapeHtml(relativePing(ping.timestamp))}${ping.accuracy != null ? ` · ±${Math.round(ping.accuracy)}m` : ""}${ping.stale ? " · stale" : ""}</div>`,
    );
  }
  return `<div style="max-width:240px">${rows.join("")}</div>`;
}

export function propertyInfoHtml(p: OpsMapProperty): string {
  const status = p.status ? ` · ${escapeHtml(p.status.replace(/_/g, " "))}` : "";
  const link = p.jobId
    ? `<br/><a href="/v2/admin/jobs/${encodeURIComponent(p.jobId)}" style="color:#7a6f2e">Open job →</a>`
    : "";
  return `<div style="font:500 13px system-ui;color:#2a241d">${escapeHtml(p.name)}<br/><span style="font-weight:400;color:#8a7f70">${escapeHtml(p.suburb ?? "")}${status}</span>${link}</div>`;
}

