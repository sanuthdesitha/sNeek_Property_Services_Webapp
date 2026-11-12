/** Where an administrator's old `/urgent-stock?propertyId=…` link now lands. */
export function urgentStockOfficeHref(propertyId?: string | null): string {
  const params = new URLSearchParams({ tab: "urgent-stock" });
  if (propertyId) params.set("propertyId", propertyId);
  return `/v2/admin/inventory?${params.toString()}`;
}
