import { NextResponse } from "next/server";
import { getApiErrorStatus } from "@/lib/api/http";
import { changePropertyFavorites, readPropertyFavorites, requirePropertyFavoritesContext, PropertyFavoritesError } from "@/lib/client/property-favorites-store";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function errorResponse(error: unknown) {
  const status = error instanceof PropertyFavoritesError ? error.status : getApiErrorStatus(error, 503);
  return NextResponse.json({ error: error instanceof PropertyFavoritesError ? error.message : "Property preferences are unavailable." }, { status, headers });
}
export async function GET() {
  try {
    const owner = await requirePropertyFavoritesContext();
    return NextResponse.json({ state: await readPropertyFavorites(owner.portal), context: owner.context, readOnly: owner.readOnly }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const owner = await requirePropertyFavoritesContext();
    if (owner.readOnly || request.headers.get("X-Property-Preferences-Context") !== owner.context) {
      throw new PropertyFavoritesError(403, "Property preferences cannot be changed in this account context. Reload this page.");
    }
    return NextResponse.json({ state: await changePropertyFavorites(owner.portal, await request.json().catch(() => null)), context: owner.context, readOnly: false }, { headers });
  } catch (error) { return errorResponse(error); }
}
