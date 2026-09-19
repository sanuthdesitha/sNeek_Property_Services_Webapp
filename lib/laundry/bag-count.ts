/** Optional prospective count: legacy confirmations remain unknown. */
export function parseLaundryBagCountInput(input: string): number | undefined {
  if (!input.trim()) return undefined;
  const count = Number(input);
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("Bags ready must be a whole number from 1 to 50.");
  return count;
}
