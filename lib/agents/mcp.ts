import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AgentAuthError, authenticateAgent, type AgentContext } from "./access";
import { ALL_AGENT_TOOLS, ToolDeniedError, ToolInputError, toolsFor, UNTRUSTED_NOTICE, type AgentTool } from "./tools";

/**
 * A small Model Context Protocol server over Streamable HTTP (2026-11-14),
 * implemented directly (JSON-RPC 2.0, JSON responses, stateless; no SSE
 * stream and no session id). Methods: initialize, notifications/initialized,
 * ping, tools/list, tools/call. Write tools (step 6) only create requests
 * that wait for a person's approval; nothing here can execute a change (the
 * executor, lib/agents/action-execute.ts, is never imported by this module).
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "sneek-estate", title: "sNeek Estate", version: "1.1.0" };
const INSTRUCTIONS = `Access to sNeek operations within this agent's scope. ${UNTRUSTED_NOTICE} Missing values read "not recorded"; they are never zero. This server cannot change anything by itself: a write tool (request_*) only creates a request that waits for a person to approve it in the app, and get_action_request reports what happened.`;

function toolAnnotations(tool: AgentTool) {
  return tool.kind === "write"
    ? { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    : { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
}

const messageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().max(200), z.number()]).optional(),
  method: z.string().min(1).max(100),
  params: z.record(z.unknown()).optional(),
}).strict();

type JsonRpcId = string | number | null;
export type McpHttpResult = { status: number; body: unknown | null; headers?: Record<string, string> };

function rpcError(id: JsonRpcId, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

type AuditInput = { context: AgentContext | null; agentId?: string | null; tokenId?: string | null; method: string; tool?: string | null; argsSummary?: Record<string, unknown> | null; outcome: string; errorCode?: string | null; resultBytes?: number | null; started: number };

/** One append-only row per request. Never the token, never full arguments. */
async function audit(input: AuditInput) {
  try {
    await db.agentAuditEntry.create({ data: {
      agentId: input.context?.agentId ?? input.agentId ?? null,
      tokenId: input.context?.tokenId ?? input.tokenId ?? null,
      creatorId: input.context?.creatorId ?? null,
      method: input.method.slice(0, 100),
      tool: input.tool ?? null,
      argsSummary: (input.argsSummary ?? undefined) as Prisma.InputJsonValue | undefined,
      outcome: input.outcome,
      errorCode: input.errorCode ?? null,
      resultBytes: input.resultBytes ?? null,
      latencyMs: Date.now() - input.started,
    } });
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : "unknown" }, "[agents] audit write failed");
  }
}

function summarize(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in args).map((key) => {
    const value = args[key];
    return [key, typeof value === "string" ? value.slice(0, 80) : typeof value === "number" || typeof value === "boolean" ? value : "[omitted]"];
  }));
}

export async function handleMcpPost(input: { authorization: string | null; body: unknown }): Promise<McpHttpResult> {
  const started = Date.now();
  const parsed = messageSchema.safeParse(input.body);
  const methodName = parsed.success ? parsed.data.method : "invalid";
  let context: AgentContext;
  try {
    context = await authenticateAgent(input.authorization);
  } catch (error) {
    if (error instanceof AgentAuthError) {
      await audit({ context: null, agentId: error.agentId, tokenId: error.tokenId, method: methodName, outcome: "REFUSED", errorCode: error.code, started });
      const headers: Record<string, string> = error.status === 401 ? { "WWW-Authenticate": 'Bearer realm="sneek-agent"' } : error.status === 429 ? { "Retry-After": "60" } : {};
      return { status: error.status, body: { error: error.message, code: error.code }, headers };
    }
    throw error;
  }
  if (Array.isArray(input.body)) {
    await audit({ context, method: "batch", outcome: "INVALID", errorCode: "BATCH", started });
    return { status: 400, body: rpcError(null, -32600, "Batch requests are not supported.") };
  }
  if (!parsed.success) {
    await audit({ context, method: "invalid", outcome: "INVALID", errorCode: "PARSE", started });
    return { status: 400, body: rpcError(null, -32600, "Invalid JSON-RPC request.") };
  }
  const { id, method, params } = parsed.data;
  const replyId: JsonRpcId = id ?? null;

  // Notifications (no id) get 202 and no body.
  if (id === undefined) {
    await audit({ context, method, outcome: "OK", started });
    return { status: 202, body: null };
  }

  if (method === "initialize") {
    const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
    const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
    await audit({ context, method, outcome: "OK", started });
    return { status: 200, body: { jsonrpc: "2.0", id: replyId, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS } } };
  }
  if (method === "ping") {
    await audit({ context, method, outcome: "OK", started });
    return { status: 200, body: { jsonrpc: "2.0", id: replyId, result: {} } };
  }
  if (method === "tools/list") {
    const tools = toolsFor(context).map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: toolAnnotations(tool) }));
    await audit({ context, method, outcome: "OK", resultBytes: JSON.stringify(tools).length, started });
    return { status: 200, body: { jsonrpc: "2.0", id: replyId, result: { tools } } };
  }
  if (method === "tools/call") {
    const name = typeof params?.name === "string" ? params.name : "";
    const args = params?.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
    const tool = ALL_AGENT_TOOLS.find((item) => item.name === name);
    if (!tool) {
      await audit({ context, method, tool: name.slice(0, 100) || null, outcome: "INVALID", errorCode: "UNKNOWN_TOOL", started });
      return { status: 200, body: rpcError(replyId, -32602, `Unknown tool: ${name.slice(0, 100)}`) };
    }
    const summary = summarize(args, tool.auditKeys);
    const toolResult = (text: string, isError: boolean, structured?: Record<string, unknown>) => ({ status: 200, body: { jsonrpc: "2.0", id: replyId, result: { content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}), isError } } });
    if (!toolsFor(context).includes(tool)) {
      await audit({ context, method, tool: tool.name, argsSummary: summary, outcome: "DENIED", errorCode: "SCOPE", started });
      return toolResult(`This agent cannot use ${tool.name}: the area is outside its access, or its creator can no longer read it.`, true);
    }
    const valid = tool.input.safeParse(args);
    if (!valid.success) {
      await audit({ context, method, tool: tool.name, argsSummary: summary, outcome: "INVALID", errorCode: "ARGUMENTS", started });
      return toolResult(`Invalid arguments for ${tool.name}: ${valid.error.issues.map((issue) => `${issue.path.join(".") || "(arguments)"} ${issue.message}`).join("; ")}`, true);
    }
    try {
      const data = await tool.run(context, valid.data);
      const text = JSON.stringify(data);
      await audit({ context, method, tool: tool.name, argsSummary: summary, outcome: "OK", resultBytes: text.length, started });
      return toolResult(text, false, data);
    } catch (error) {
      const known = error instanceof ToolInputError || error instanceof ToolDeniedError;
      await audit({ context, method, tool: tool.name, argsSummary: summary, outcome: error instanceof ToolDeniedError ? "DENIED" : known ? "INVALID" : "ERROR", errorCode: known ? error.name : "INTERNAL", started });
      return toolResult(known ? error.message : "The data could not be read right now. Try again later.", true);
    }
  }
  await audit({ context, method, outcome: "INVALID", errorCode: "METHOD", started });
  return { status: 200, body: rpcError(replyId, -32601, `Method not supported: ${method}`) };
}
