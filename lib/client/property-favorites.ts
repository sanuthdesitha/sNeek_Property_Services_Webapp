import { z } from "zod";

export const propertyFavoritesSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  ids: z.array(z.string().min(1).max(128)).max(200),
  view: z.enum(["cards", "compact"]),
}).strict().refine(value => new Set(value.ids).size === value.ids.length);
export type PropertyFavorites = z.infer<typeof propertyFavoritesSchema>;
export const emptyPropertyFavorites = (): PropertyFavorites => ({ version: 1, revision: 0, ids: [], view: "cards" });
export const propertyFavoriteMutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pin"), propertyId: z.string().min(1).max(128), revision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("unpin"), propertyId: z.string().min(1).max(128), revision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("view"), view: z.enum(["cards", "compact"]), revision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("clear"), revision: z.number().int().nonnegative() }).strict(),
]);
