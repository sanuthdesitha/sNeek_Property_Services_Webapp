import { destinationOf, type BoundEvidence } from "@/lib/cleaner/evidence-destination";

type Receipt = BoundEvidence & { formRevision: string };
export function isLaundryReceipt(receipt: BoundEvidence) {
  const destination = destinationOf(receipt);
  return destination.type === "laundry" || (destination.type === "formField" && destination.fieldId === "laundry_photo");
}

/** Validate only this handoff's evidence; other job evidence remains in its own workflow. */
export function earlyLaundryEvidenceConflict(receipts: Record<string, Receipt>, input: {
  outcome: string; photoKey?: string; formRevision?: string;
}) {
  const usedKey = input.photoKey?.trim();
  return Object.values(receipts).some(receipt => {
    if (receipt.key === usedKey && (receipt.detached || !isLaundryReceipt(receipt))) return true;
    if (receipt.detached || !isLaundryReceipt(receipt)) return false;
    return input.outcome !== "READY_FOR_PICKUP" || receipt.key !== usedKey || receipt.formRevision !== input.formRevision;
  });
}
