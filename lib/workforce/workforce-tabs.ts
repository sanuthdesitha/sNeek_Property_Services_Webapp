/**
 * Workforce area tabs (board "Workforce", 2026-11-16). Each tab keeps its own
 * URL, so the old deep links (/v2/admin/workforce/compliance, …/roster,
 * …/coaching, …/recognition) open the matching tab; Leave and availability is
 * new. The old overview URL still redirects to People › Cleaners. Plain
 * module: safe for server pages and clients.
 */
export type WorkforceTabKey = "compliance" | "roster" | "leave" | "coaching" | "recognition";

export type WorkforceTab = {
  key: WorkforceTabKey;
  label: string;
  /** The shorter label of the phone tab strip (board M-Workforce). */
  phoneLabel: string;
  href: string;
};

export const WORKFORCE_TABS: readonly WorkforceTab[] = [
  { key: "compliance", label: "Compliance", phoneLabel: "Compliance", href: "/v2/admin/workforce/compliance" },
  { key: "roster", label: "Roster", phoneLabel: "Roster", href: "/v2/admin/workforce/roster" },
  { key: "leave", label: "Leave and availability", phoneLabel: "Leave", href: "/v2/admin/workforce/leave" },
  { key: "coaching", label: "Coaching", phoneLabel: "Coaching", href: "/v2/admin/workforce/coaching" },
  { key: "recognition", label: "Recognition", phoneLabel: "Kudos", href: "/v2/admin/workforce/recognition" },
];

export type WorkforceTabCounts = Partial<Record<WorkforceTabKey, { value: number; suffix?: string }>>;

/** "Documents, leave, coaching and recognition for 14 cleaners and 2 laundry staff." */
export function workforceIntro(cleaners: number | null, laundry: number | null): string {
  if (cleaners === null || laundry === null) return "Documents, leave, coaching and recognition for the team.";
  const people = [`${cleaners} cleaner${cleaners === 1 ? "" : "s"}`, `${laundry} laundry staff`].join(" and ");
  return `Documents, leave, coaching and recognition for ${people}. Opened from People › Cleaners › Team tools.`;
}
