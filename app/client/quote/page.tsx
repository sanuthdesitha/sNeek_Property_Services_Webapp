import { ensureClientModuleAccess } from "@/lib/portal-access";
import { redirect } from "next/navigation";

export default async function ClientQuoteRedirectPage() {
  await ensureClientModuleAccess("quoteRequests");
  redirect("/quote");
}
