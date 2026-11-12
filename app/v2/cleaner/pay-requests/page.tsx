import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Extra pay requests are a tab of Pay (approved cleaner board, 2026-11). The old
 * URL keeps working — job screens and notifications link here with `?jobId=` —
 * and lands on Pay → Requests with the job preselected.
 */
export default function V2CleanerPayRequestsRedirect({ searchParams }: { searchParams?: { jobId?: string } }) {
  const jobId = typeof searchParams?.jobId === "string" ? searchParams.jobId : null;
  redirect(jobId ? `/v2/cleaner/pay?tab=requests&jobId=${encodeURIComponent(jobId)}` : "/v2/cleaner/pay?tab=requests");
}
