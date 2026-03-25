import { NextRequest, NextResponse } from "next/server";
import { publicQuoteSchema } from "@/lib/validations/quote";
import { calculateQuote } from "@/lib/pricing/calculator";
import { getValidationErrorMessage } from "@/lib/validations/errors";

export async function POST(req: NextRequest) {
  try {
    const body = publicQuoteSchema.parse(await req.json());
    const result = await calculateQuote(body);
    return NextResponse.json(result);
  } catch (err: any) {
    const requiresManualQuote = err?.code === "NO_PRICEBOOK_MATCH" || /No price book entry/i.test(err?.message ?? "");
    if (requiresManualQuote) {
      return NextResponse.json(
        {
          error: err.message,
          requiresManualQuote: true,
          requiresAdminApproval: true,
          isEstimate: true,
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not calculate quote.") }, { status: 400 });
  }
}
