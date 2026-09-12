import "server-only";
import { getPresignedDownloadUrl } from "@/lib/s3";

// Walks a form template schema and resolves any reference media that was
// uploaded (has a `storageKey` but no `url`) into a short-lived presigned GET
// URL, so the person filling the form can actually view the example. External
// links (which already carry a `url`) pass through untouched.
//
// Used by the cleaner job-form API: cleaners can't hit the admin-scoped
// /api/uploads/access endpoint for arbitrary keys, so resolution happens here.

async function resolveFieldReferences(field: any): Promise<any> {
  if (!field || typeof field !== "object" || Array.isArray(field)) return field;
  const references = Array.isArray(field.references) ? await Promise.all(
    field.references.map(async (ref: any) => {
      if (ref?.storageKey && !ref?.url) {
        try {
          const url = await getPresignedDownloadUrl(ref.storageKey, 3600);
          return { ...ref, url };
        } catch {
          return ref;
        }
      }
      return ref;
    })
  ) : field.references;
  // Children can own references even when their parent has none.
  const children = Array.isArray(field.children)
    ? await Promise.all(field.children.map(resolveFieldReferences))
    : field.children;
  return {
    ...field,
    ...(Array.isArray(field.references) ? { references } : {}),
    ...(Array.isArray(field.children) ? { children } : {}),
  };
}

// Resolves the optional `schema.theme.logoKey` (uploaded logo) into a viewable
// presigned `logoUrl` so the cleaner-facing form can render the logo without
// hitting the admin-scoped access endpoint. Themes without an uploaded logo
// (or with an external `logoUrl` already set) pass through untouched.
async function resolveThemeLogo(theme: any): Promise<any> {
  if (!theme || typeof theme !== "object") return theme;
  if (theme.logoKey && !theme.logoUrl) {
    try {
      const logoUrl = await getPresignedDownloadUrl(theme.logoKey, 3600);
      return { ...theme, logoUrl };
    } catch {
      return theme;
    }
  }
  return theme;
}

export async function resolveTemplateReferenceUrls<T extends { schema?: any } | null>(
  template: T
): Promise<T> {
  if (!template || !template.schema || !Array.isArray(template.schema.sections)) {
    return template;
  }
  const sections = await Promise.all(
    template.schema.sections.map(async (section: any) => ({
      ...section,
      fields: Array.isArray(section?.fields)
        ? await Promise.all(section.fields.map(resolveFieldReferences))
        : section?.fields,
    }))
  );
  const theme = await resolveThemeLogo(template.schema.theme);
  return { ...template, schema: { ...template.schema, sections, theme } };
}
