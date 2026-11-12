/** Links into and out of the property pages. Plain module so server and client code can share them. */
export function propertyHref(propertyId: string, tab?: string): string {
  const base = `/v2/admin/properties/${encodeURIComponent(propertyId)}`;
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
}

/** The New job form, pre-filled with this property (the form reads `?propertyId=`). */
export function newJobHref(propertyId: string): string {
  return `/v2/admin/jobs/new?propertyId=${encodeURIComponent(propertyId)}`;
}

export function copyPropertyHref(propertyId: string): string {
  return `/v2/admin/properties/new?copyFrom=${encodeURIComponent(propertyId)}`;
}

export function jobHref(jobId: string): string {
  return `/v2/admin/jobs/${encodeURIComponent(jobId)}`;
}

/** The Jobs list with this job's peek panel open (assign, suggestions). */
export function jobPeekHref(jobId: string): string {
  return `/v2/admin/jobs?open=${encodeURIComponent(jobId)}`;
}

export const PROPERTY_FORM_SETTINGS_HREF = "/v2/admin/settings/property-form";
