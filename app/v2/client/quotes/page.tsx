import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ClientQuotesBoard, type QuoteFocusIntent } from "@/components/v2/client/quotes-board";

const INTENTS: readonly QuoteFocusIntent[] = ["accept", "decline", "change"];

export const metadata = { title: "Quotes · Estate client" };
export const dynamic = "force-dynamic";

export default async function V2ClientQuotesRoute({ searchParams }: { searchParams?: { quote?: string; intent?: string } }) {
  await requireRole([Role.CLIENT]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Quotes"
        description="Your requested estimates and their status — review, accept, or decline."
      />
      <ClientQuotesBoard
        focusQuoteId={typeof searchParams?.quote === "string" ? searchParams.quote : undefined}
        intent={INTENTS.find((value) => value === searchParams?.intent)}
      />
    </div>
  );
}
