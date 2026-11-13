const MOBILE_PATHS: Record<string, readonly string[]> = {
  admin: ["", "jobs", "calendar", "approvals", "properties"],
  client: ["", "jobs", "approvals", "finance", "more"],
  cleaner: ["", "jobs", "supplies", "pay", "more"],
  qa: ["", "reviews", "rework", "pay", "more"],
  laundry: ["", "runs", "tracking", "history", "more"],
  maintenance: ["", "tickets", "replacements", "log", "more"],
};

/**
 * Portals whose PHONE tab bar (below 640px) ends with a "More" sheet instead
 * of a page (board "Admin phone", 2026-11): these four tabs, then More, which
 * holds every other authorized destination grouped like the rail. From 640px
 * up to the desktop rail the bar above (MOBILE_PATHS) is unchanged.
 */
const PHONE_SHEET_PATHS: Record<string, readonly string[]> = {
  admin: ["", "jobs", "calendar", "approvals"],
};

function pick<T extends { href: string }>(portal: string, paths: readonly string[], nav: readonly T[]): T[] {
  return paths.flatMap((path) => {
    const href = `/v2/${portal}${path ? `/${path}` : ""}`;
    const item = nav.find((entry) => entry.href === href);
    return item ? [item] : [];
  });
}

/** Match only authorized navigation entries; never fill gaps with unrelated tabs. */
export function mobileTabs<T extends { href: string }>(portal: string, nav: readonly T[]): T[] {
  return pick(portal, MOBILE_PATHS[portal] ?? [], nav);
}

/** Whether this portal's phone bar ends with the More sheet. */
export function hasPhoneMoreSheet(portal: string): boolean {
  return portal in PHONE_SHEET_PATHS;
}

/**
 * The phone tabs before "More" (authorized entries only), or an empty list
 * when the portal has no More sheet.
 */
export function phoneSheetTabs<T extends { href: string }>(portal: string, nav: readonly T[]): T[] {
  return pick(portal, PHONE_SHEET_PATHS[portal] ?? [], nav);
}

export type PhoneMoreSection<T> = { group: string; items: T[] };

/**
 * What the More sheet lists: every authorized rail entry that is not one of
 * the phone tabs, in rail order, grouped by the rail's groups (ungrouped
 * entries under "Other"), filtered by `query` on label and group.
 */
export function phoneMoreSections<T extends { href: string; label: string; group?: string }>(
  tabs: readonly T[],
  nav: readonly T[],
  query = "",
): PhoneMoreSection<T>[] {
  const tabHrefs = new Set(tabs.map((tab) => tab.href));
  const needle = query.trim().toLowerCase();
  const sections: PhoneMoreSection<T>[] = [];
  for (const item of nav) {
    if (tabHrefs.has(item.href)) continue;
    const group = item.group ?? "Other";
    if (needle && !`${item.label} ${group}`.toLowerCase().includes(needle)) continue;
    const section = sections.find((entry) => entry.group === group);
    if (section) section.items.push(item);
    else sections.push({ group, items: [item] });
  }
  return sections;
}
