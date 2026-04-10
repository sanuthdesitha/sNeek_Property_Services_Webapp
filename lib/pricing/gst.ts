export interface GstSettings {
  gstEnabled: boolean;
}

export interface GstBreakdown {
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}

export function calculateGstBreakdown(subtotalValue: number, settings: GstSettings): GstBreakdown {
  const subtotal = roundCurrency(Math.max(0, Number(subtotalValue) || 0));
  const gstAmount = settings.gstEnabled ? roundCurrency(subtotal * 0.1) : 0;
  const totalAmount = roundCurrency(subtotal + gstAmount);
  return { subtotal, gstAmount, totalAmount };
}

export function getGstDisplayLabel(settings: GstSettings) {
  return settings.gstEnabled ? "GST (10%)" : "GST not applied";
}
