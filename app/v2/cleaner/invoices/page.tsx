import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Invoices is a tab of Pay (approved cleaner board, 2026-11). The old URL keeps
 * working: it lands on Pay → Invoices with its `preset` intact.
 */
export default function V2CleanerInvoicesRedirect({ searchParams }: { searchParams?: { preset?: string } }) {
  const preset = typeof searchParams?.preset === "string" ? searchParams.preset : null;
  redirect(preset ? `/v2/cleaner/pay?tab=invoices&preset=${encodeURIComponent(preset)}` : "/v2/cleaner/pay?tab=invoices");
}
