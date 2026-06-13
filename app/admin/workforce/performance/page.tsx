import { redirect } from "next/navigation";

// The performance leaderboard now lives as the "Performance" tab of the unified
// Workforce hub. The per-cleaner detail route (./[userId]) is unchanged and the
// leaderboard there links straight to it.
export default function CleanerPerformanceRedirect() {
  redirect("/admin/workforce?tab=performance");
}
