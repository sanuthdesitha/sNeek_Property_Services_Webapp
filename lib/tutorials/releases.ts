/**
 * Release notes for pages that have a tour (plain module). Every visible
 * change to such a page is listed here in the same change, against the tour
 * step that teaches it (a What's new step) or with a "no visible change"
 * reason. Settings › System › Tutorials shows this list beside the tours, so
 * an administrator can check that nothing shipped without a tutorial.
 */

export type ReleaseItem = {
  change: string;
  /** The tour, version and step that cover the change. */
  covered?: { tourKey: string; version: number; stepIds: string[] };
  /** Why no tour change was needed (same screen, speed only, wording only). */
  noVisibleChange?: string;
};

export type ReleaseNote = {
  release: string;
  /** Calendar day, yyyy-MM-dd. */
  date: string;
  author: string;
  items: ReleaseItem[];
};

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    release: "2026.11.16",
    date: "2026-11-16",
    author: "Tutorials launch",
    items: [
      { change: "Help (?) added to every portal header: replay this page's tour, walkthroughs, Show tours.", noVisibleChange: "New feature: the tours themselves are its introduction." },
      { change: "Welcome screens for every role on first sign-in.", covered: { tourKey: "welcome.cleaner", version: 1, stepIds: ["hello", "three", "practice"] } },
      { change: "Command, Jobs and Approvals page tours for the office.", covered: { tourKey: "admin.jobs", version: 1, stepIds: ["filters", "unassigned", "row", "bulk", "new"] } },
      { change: "Practice walkthroughs: create a job, send an invoice, a cleaner's job from offer to submit, a laundry pickup.", covered: { tourKey: "cleaner.job.practice", version: 1, stepIds: ["accept", "submit"] } },
    ],
  },
];
