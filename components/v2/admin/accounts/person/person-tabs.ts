/**
 * The tabs of a person's full page (/v2/admin/accounts/users/[id]). A plain
 * module so the server page can read `?tab=` and the client page can render.
 */
export const PERSON_PAGE_TABS = ["overview", "jobs", "pay", "documents", "leave", "quality", "access", "notifications", "activity"] as const;

export type PersonPageTab = (typeof PERSON_PAGE_TABS)[number];

export const PERSON_PAGE_TAB_LABEL: Record<PersonPageTab, string> = {
  overview: "Overview", jobs: "Jobs", pay: "Pay and invoices", documents: "Documents", leave: "Leave and availability", quality: "Quality and coaching", access: "Access", notifications: "Notifications", activity: "Activity",
};

/** `?tab=` of the person page; anything unknown opens Overview (old links keep working). */
export function personPageTab(value: string | null | undefined): PersonPageTab {
  return (PERSON_PAGE_TABS as readonly string[]).includes(value ?? "") ? (value as PersonPageTab) : "overview";
}
