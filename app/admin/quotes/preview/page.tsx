import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { QuotePreviewPage } from "@/components/admin/quote-preview-page";

export default async function AdminQuotePreviewPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <QuotePreviewPage />;
}
