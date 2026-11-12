/**
 * The PATCH body for a laundry partner (PATCH /api/admin/laundry/suppliers/[id]).
 * That route writes every field it is given and nulls an omitted optional
 * field, so a change to the team or the link must resend the whole record.
 * PURE and PLAIN.
 */
import type { LaundryPartnerRecord, LaundryUserOption } from "./directory-types";

export type PartnerPatchBody = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  pricePerKg: number | null;
  avgTurnaround: number | null;
  reliabilityScore: number | null;
  notes: string | null;
  isActive: boolean;
  stockSupplierId?: string | null;
  teamUserIds?: string[];
};

export function partnerPatchBody(partner: LaundryPartnerRecord, change: { teamUserIds?: string[]; stockSupplierId?: string | null } = {}): PartnerPatchBody {
  return {
    name: partner.name,
    phone: partner.phone,
    email: partner.email,
    address: partner.address,
    pricePerKg: partner.pricePerKg,
    avgTurnaround: partner.avgTurnaround,
    reliabilityScore: partner.reliabilityScore,
    notes: partner.notes,
    isActive: partner.isActive,
    ...(change.stockSupplierId !== undefined ? { stockSupplierId: change.stockSupplierId } : {}),
    ...(change.teamUserIds !== undefined ? { teamUserIds: change.teamUserIds } : {}),
  };
}

/**
 * A laundry login belongs to exactly one partner (one nullable link). Adding
 * someone who is on another partner's team moves them: these are the moves a
 * save would make, with the partner each person leaves, for the confirmation.
 */
export function teamMoves(teamUserIds: readonly string[], partnerId: string | null, users: readonly LaundryUserOption[], partnerNames: ReadonlyMap<string, string>): Array<{ userId: string; name: string; from: string }> {
  return teamUserIds.flatMap((id) => {
    const user = users.find((row) => row.id === id);
    if (!user?.laundrySupplierId || user.laundrySupplierId === partnerId) return [];
    return [{ userId: id, name: user.name?.trim() || user.email, from: partnerNames.get(user.laundrySupplierId) ?? "another laundry partner" }];
  });
}

export function moveConfirmText(moves: ReadonlyArray<{ name: string; from: string }>, partnerName: string): string {
  const list = moves.map((move) => `${move.name} leaves ${move.from}`).join("; ");
  return `${list}, and joins ${partnerName || "this partner"}. A laundry login belongs to one laundry partner only.`;
}
