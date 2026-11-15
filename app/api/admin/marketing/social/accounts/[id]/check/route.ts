import { NextRequest, NextResponse } from "next/server";
import { checkAccount, listAccounts } from "@/lib/marketing/social/accounts";
import { requireSocialRight, socialErrorResponse, socialHttp } from "@/lib/marketing/social/route-helpers";

/** "Check now": reads the Page name or Instagram limit with the stored sign-in. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSocialRight("post");
    const result = await checkAccount({ accountId: params.id, http: socialHttp().http });
    return NextResponse.json({ ...result, accounts: await listAccounts() });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
