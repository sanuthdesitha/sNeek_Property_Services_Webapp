/** Allocate integer cents/minutes cumulatively so split deliveries never overcharge. */
export function deliveryShare(total: number, originalQuantity: number, deliveredBefore: number, deliveredNow: number) {
  if (![total, originalQuantity, deliveredBefore, deliveredNow].every(Number.isFinite) || total < 0 || originalQuantity <= 0 || deliveredBefore < 0 || deliveredNow <= 0) throw new Error("Invalid shopping delivery allocation.");
  const amount = Math.round(total);
  const before = Math.min(originalQuantity, deliveredBefore);
  const after = Math.min(originalQuantity, deliveredBefore + deliveredNow);
  return Math.floor(amount * after / originalQuantity + 1e-8) - Math.floor(amount * before / originalQuantity + 1e-8);
}
