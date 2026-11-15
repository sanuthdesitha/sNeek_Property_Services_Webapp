/**
 * The Meta permissions sNeek asks for when connecting (2026-11-17). Plain
 * module: the setup steps on screen and the connect flow use the same list.
 */
export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "read_insights",
  "instagram_manage_insights",
] as const;
