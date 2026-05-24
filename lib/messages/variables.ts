import { db } from "@/lib/db";
import { format } from "date-fns";

export interface VariableContext {
  client?: { id: string };
  cleaner?: { id: string };
  job?: { id: string };
  property?: { id: string };
  quote?: { id: string };
  user?: { id: string };
}

/**
 * Resolves variables in a template string. Supported syntax:
 *   {{client.firstName}}
 *   {{job.scheduledFor | date short}}
 *   {{property.suburb}}
 *   {{quote.totalAmount | currency}}
 *
 * Filters: date [short|long], time, currency, upper, lower
 */
export async function resolveTemplate(
  template: string,
  ctx: VariableContext,
): Promise<string> {
  const cache: Record<string, any> = {};

  const loaders: Record<string, () => Promise<any>> = {
    client: async () => {
      if (!ctx.client?.id) return null;
      const c = await db.client.findUnique({ where: { id: ctx.client.id } });
      if (!c) return null;
      const parts = (c.name ?? "").trim().split(/\s+/);
      return {
        ...c,
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
      };
    },
    cleaner: async () => {
      if (!ctx.cleaner?.id) return null;
      const u = await db.user.findUnique({ where: { id: ctx.cleaner.id } });
      if (!u) return null;
      const parts = (u.name ?? "").trim().split(/\s+/);
      return {
        ...u,
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
      };
    },
    user: async () => {
      if (!ctx.user?.id) return null;
      const u = await db.user.findUnique({ where: { id: ctx.user.id } });
      if (!u) return null;
      const parts = (u.name ?? "").trim().split(/\s+/);
      return {
        ...u,
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
      };
    },
    job: async () => {
      if (!ctx.job?.id) return null;
      const j = await db.job.findUnique({
        where: { id: ctx.job.id },
        include: { property: true, assignments: { include: { user: true } } },
      });
      if (!j) return null;
      // Provide a friendly alias `scheduledFor` that maps to `scheduledDate`
      return { ...j, scheduledFor: j.scheduledDate };
    },
    property: async () => {
      if (!ctx.property?.id) return null;
      return db.property.findUnique({ where: { id: ctx.property.id } });
    },
    quote: async () => {
      if (!ctx.quote?.id) return null;
      try {
        return await (db as any).quote.findUnique({
          where: { id: ctx.quote.id },
        });
      } catch {
        return null;
      }
    },
  };

  async function get(key: string) {
    if (!(key in cache)) {
      const loader = loaders[key];
      cache[key] = loader ? await loader() : null;
    }
    return cache[key];
  }

  function applyFilter(value: any, filter: string): string {
    const [name, ...args] = filter.split(/\s+/);
    if (value === null || value === undefined) return "";
    switch (name) {
      case "date": {
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) return "";
        return format(d, args[0] === "short" ? "EEE d MMM" : "PPpp");
      }
      case "time": {
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) return "";
        return format(d, "h:mm a");
      }
      case "currency":
        return `$${Number(value).toLocaleString("en-AU", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      case "upper":
        return String(value).toUpperCase();
      case "lower":
        return String(value).toLowerCase();
      default:
        return String(value);
    }
  }

  const tokens = Array.from(template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g));
  let output = template;
  for (const match of tokens) {
    const expr = match[1];
    const [path, ...filterParts] = expr.split("|").map((s) => s.trim());
    const filter = filterParts.join("|");
    const parts = path.split(".");
    const rootKey = parts[0];
    const obj = await get(rootKey);
    let value: any = obj;
    for (const p of parts.slice(1)) {
      value = value == null ? undefined : value[p];
    }
    const rendered = filter
      ? applyFilter(value, filter)
      : value === undefined || value === null
        ? ""
        : String(value);
    output = output.split(match[0]).join(rendered);
  }

  return output;
}

/**
 * Extract variable paths from a template. Useful for autocomplete/preview.
 * Returns unique paths like ["client.firstName", "job.scheduledFor"].
 */
export function extractVariablePaths(template: string): string[] {
  const tokens = Array.from(template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g));
  const set = new Set<string>();
  for (const m of tokens) {
    const path = m[1].split("|")[0].trim();
    set.add(path);
  }
  return Array.from(set);
}
