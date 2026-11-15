// @vitest-environment node
/**
 * Agents and AI never publish or connect (social post generator,
 * 2026-11-17): nothing the MCP server can reach imports the publish, account
 * or scheduled-post modules, or the agent executor; the AI caption module
 * does not import them either. New packs default off and are capped like
 * the others.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AGENT_SCOPES } from "@/lib/agents/scopes";
import { AGENT_WRITE_SCOPES } from "@/lib/agents/write-scopes";
import { SOCIAL_NETWORKS } from "@/lib/marketing/social/networks";

vi.mock("server-only", () => ({}));

const ROOT = path.resolve(__dirname, "../..");

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(ROOT, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  return null;
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.join(ROOT, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of Array.from(source.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g))) {
      const spec = match[1] ?? match[2];
      if (/^import\s+type\s/.test(match[0])) continue;
      const resolved = resolveImport(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return new Set(Array.from(seen).map((file) => path.relative(ROOT, file)));
}

const FORBIDDEN = ["lib/marketing/social/publish.ts", "lib/marketing/social/accounts.ts", "lib/marketing/social/scheduled.ts", "lib/marketing/social/networks/meta.ts", "lib/agents/action-execute.ts"];

describe("agents and AI cannot reach posting or connecting", () => {
  it("the MCP server's imports never include publish, accounts, planned posts, the Meta client or the executor", () => {
    const files = reachable("lib/agents/mcp.ts");
    expect(files.has("lib/agents/social-tools.ts")).toBe(true);
    for (const forbidden of FORBIDDEN) expect(files.has(forbidden), forbidden).toBe(false);
  });

  it("AI caption help cannot post either", () => {
    const files = reachable("lib/marketing/social/ai-captions.ts");
    for (const forbidden of FORBIDDEN) expect(files.has(forbidden), forbidden).toBe(false);
  });

  it("the new packs exist, are tied to Marketing, and are not granted by default", () => {
    expect(AGENT_SCOPES.find((scope) => scope.key === "social")).toMatchObject({ opsArea: "marketing" });
    expect(AGENT_WRITE_SCOPES.find((scope) => scope.key === "social_drafts")).toMatchObject({ opsAreas: ["marketing"] });
  });

  it("only Facebook and Instagram have an API path; the others are honest about why not", () => {
    expect(SOCIAL_NETWORKS.filter((network) => network.apiState === "api").map((network) => network.key)).toEqual(["INSTAGRAM", "FACEBOOK"]);
    for (const network of SOCIAL_NETWORKS.filter((item) => item.apiState !== "api")) expect(network.whyNot).toBeTruthy();
  });
});
