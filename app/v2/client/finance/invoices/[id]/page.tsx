import { InvoiceSummaryPage } from "@/components/v2/shared/invoice-summary-page";

export const dynamic = "force-dynamic";
export default function Page({ params }: { params: { id: string } }) {
  return <InvoiceSummaryPage id={params.id} portal="client" />;
}
