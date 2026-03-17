import { ensureCleanerModuleAccess } from "@/lib/portal-access";

export default async function CleanerJobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await ensureCleanerModuleAccess("jobs");
  return children;
}
