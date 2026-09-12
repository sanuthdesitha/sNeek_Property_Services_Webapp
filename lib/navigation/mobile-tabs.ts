const MOBILE_PATHS: Record<string, readonly string[]> = {
  admin: ["", "jobs", "calendar", "approvals", "properties"],
  client: ["", "jobs", "laundry", "approvals", "reports"],
  cleaner: ["", "jobs", "calendar", "route", "pay"],
  qa: ["", "reviews", "rework", "pay", "stats"],
  laundry: ["", "queue", "runs", "tracking", "calendar"],
  maintenance: ["", "tickets", "replacements", "log", "settings"],
};

/** Match only authorized navigation entries; never fill gaps with unrelated tabs. */
export function mobileTabs<T extends { href: string }>(portal: string, nav: readonly T[]): T[] {
  return (MOBILE_PATHS[portal] ?? []).flatMap((path) => {
    const href = `/v2/${portal}${path ? `/${path}` : ""}`;
    const item = nav.find((entry) => entry.href === href);
    return item ? [item] : [];
  });
}
