import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAiRouting, resolveFeatureRoute } from "@/lib/ai/provider/routing";
import { AGENT_MCP_PATH } from "@/lib/agents/scopes";
import { ECard, EPageHeader } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EToneCard, EToneNotice } from "@/components/v2/ui/tone-band";

export const metadata = { title: "Social post help · Estate admin" };
export const dynamic = "force-dynamic";

type RouteSummary = { text: string; photos: string; perHour: string; on: boolean } | null;

async function routeSummary(feature: "text_compose" | "social_post"): Promise<RouteSummary> {
  try {
    const route = await resolveFeatureRoute(feature, await getAiRouting());
    const provider = route.provider === "ollama" ? `Local Ollama · ${route.model}` : `${route.provider} · ${route.model}`;
    return {
      on: route.enabled && route.configured,
      text: !route.enabled ? "Off" : !route.configured ? `Not set up (${provider})` : provider,
      photos: feature === "text_compose" ? "not needed (text only)" : route.cloud ? (route.allowImages ? "on: only the cleaned copies are sent" : "off · turning on needs your PIN") : "stays on this server",
      perHour: String(route.hourlyLimitPerActor),
    };
  } catch {
    return null;
  }
}

/**
 * Social post help (2026-11-17, board "Social AI options"; settings catalog ›
 * Automation and AI). The honest answer to "AI without an API, with a login,
 * minimal cost": three ways, from free to "Claude with your login". Live facts
 * only where they are recorded; anything unreadable says so.
 */
export default async function SocialAiPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [textRoute, photoRoute, agentsWithSocial, waitingDrafts] = await Promise.all([
    routeSummary("text_compose"),
    routeSummary("social_post"),
    db.agentProfile.count({ where: { status: "ACTIVE", OR: [{ areas: { has: "social" } }, { writeAreas: { has: "social_drafts" } }] } }).catch(() => null),
    db.agentActionRequest.count({ where: { status: "WAITING", tool: "request_social_draft" } }).catch(() => null),
  ]);
  const site = (process.env.APP_URL || process.env.NEXTAUTH_URL || "https://<your app address>").replace(/\/+$/, "");
  const mcpUrl = `${site}${AGENT_MCP_PATH}`;

  return (
    <div className="space-y-5">
      <EPageHeader eyebrow="Setup · Settings · AI configuration" title="Social post help" description={"Three ways to get captions and photo picks, from free to \u201cClaude with your login\u201d. The generator works with all three; you can switch at any time."} />

      <EToneNotice tone="info" title={"The honest answer to \u201cAI without an API, with a login, minimal cost\u201d"}>
        <ul className="list-disc space-y-1 pl-4">
          <li><strong>Start with no AI</strong>: sNeek already scores photos with plain arithmetic and writes captions from templates. Free, private, works today.</li>
          <li>A local model on your own server costs nothing per caption, but needs a server with about 8 GB of memory for a small text model (our estimate). Photo understanding is too heavy for a modest server.</li>
          <li><strong>Claude with your login</strong>: your Claude subscription, used in Claude&apos;s own apps, connects to sNeek&apos;s agent connection, looks at the already-cropped photos and saves drafts into sNeek. No API key and no per-call bill; it runs when you ask (or on a schedule you set in Claude).</li>
        </ul>
        <p className="mt-2">A Claude subscription can never be pasted into sNeek as the server&apos;s key: Anthropic&apos;s terms keep subscription sign-in to its own apps. That is why option 3 runs in Claude, not in sNeek.</p>
      </EToneNotice>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <EToneCard tone="good" header={<h2 className="text-[0.9375rem] font-[600]">1 · No AI</h2>} pill="Recommended now">
          <dl className="space-y-1.5 text-[0.8125rem]">
            <div><dt className="font-[550]">Cost</dt><dd>$0 per post, per month</dd></div>
            <div><dt className="font-[550]">Needs</dt><dd>Nothing. sharp (already in sNeek) measures sharpness, light, contrast and duplicates.</dd></div>
            <div><dt className="font-[550]">You get</dt><dd>Ranked photos with reasons, caption templates with rotating hooks, hashtag sets, per-network limits, suggested alt text from the form field.</dd></div>
            <div><dt className="font-[550]">Leaves sNeek</dt><dd>Nothing until you post.</dd></div>
            <div><dt className="font-[550]">Limits</dt><dd>Captions read like templates; it cannot &quot;see&quot; that a photo has a nice view.</dd></div>
          </dl>
        </EToneCard>
        <EToneCard header={<h2 className="text-[0.9375rem] font-[600]">2 · Local model (Ollama)</h2>} pill={<EPill tone="neutral">Optional</EPill>}>
          <dl className="space-y-1.5 text-[0.8125rem]">
            <div><dt className="font-[550]">Cost</dt><dd>$0 per caption, plus a bigger server if yours is small</dd></div>
            <div><dt className="font-[550]">Needs</dt><dd>Ollama on your server (already supported in AI configuration). A 4-billion-parameter model such as qwen3:4b is a 2.5 GB download; plan on about 8 GB of server memory (estimate, not measured on yours).</dd></div>
            <div><dt className="font-[550]">Photos</dt><dd>Not proposed on a modest server; photo picks stay with the free scoring.</dd></div>
            <div><dt className="font-[550]">Set up by default</dt><dd>No.</dd></div>
          </dl>
        </EToneCard>
        <EToneCard tone="info" header={<h2 className="text-[0.9375rem] font-[600]">3 · Claude with your login</h2>} pill="No API key">
          <dl className="space-y-1.5 text-[0.8125rem]">
            <div><dt className="font-[550]">Cost</dt><dd>Included in your Claude plan; counts against its usage limits, shared with your chats.</dd></div>
            <div><dt className="font-[550]">Needs</dt><dd>A paid Claude plan; a sNeek agent token (ADMIN, PIN); Claude Code today, or a custom connector in the Claude app.</dd></div>
            <div><dt className="font-[550]">Leaves sNeek</dt><dd>Cropped copies only (no stamp, no camera data), room names, the suburb if allowed. Never the address, client or original.</dd></div>
            <div><dt className="font-[550]">Now</dt><dd>{agentsWithSocial === null ? "Agents could not be counted." : `${agentsWithSocial} active agent${agentsWithSocial === 1 ? "" : "s"} with the social packs`} · {waitingDrafts === null ? "waiting drafts not counted" : `${waitingDrafts} draft request${waitingDrafts === 1 ? "" : "s"} waiting`} in <a className="underline" href="/v2/admin/approvals?tab=agents">Approvals</a>.</dd></div>
          </dl>
        </EToneCard>
      </div>

      <ECard className="space-y-3 p-4">
        <h2 className="text-[0.9375rem] font-[600]">Option 3, step by step</h2>
        <ol className="list-decimal space-y-2 pl-5 text-[0.8125rem]">
          <li><strong>Create the agent in sNeek</strong> (<a className="underline" href="/v2/admin/settings/agents">Settings › Agents</a>): name it &quot;Claude, social drafts&quot;, tick the read pack &quot;Marketing photos&quot; and the write pack &quot;Ask to create social drafts&quot;, choose an expiry, confirm with your PIN. The token is shown once. It never gives administrator rights, never reads originals, addresses, clients or tokens, and cannot post.</li>
          <li><strong>Connect Claude.</strong> Claude Code (tested path): <code className="break-all">claude mcp add --transport http sneek {mcpUrl} --header &quot;Authorization: Bearer &lt;token&gt;&quot;</code>. Claude app (web or desktop, custom connector): Customize › Connectors › Add › custom connector, the same address, and under Request headers <code>Authorization</code> = <code>Bearer &lt;token&gt;</code>. Anthropic documents request-header credentials for custom connectors; this has not been tried with sNeek. Claude reaches sNeek from Anthropic&apos;s cloud, so the address must be your public https site.</li>
          <li><strong>Ask</strong> in Claude, for example: &quot;Make 3 Instagram and Facebook posts from this week&apos;s best sNeek jobs. Mix rooms, one before/after if allowed.&quot; Or a scheduled task in your Claude account if your plan has them.</li>
          <li><strong>Claude drafts</strong> through sNeek tools: <code>list_social_candidates</code> (scores and reasons), <code>get_social_photo</code> (cropped JPEG, no metadata), <code>request_social_draft</code> (photos, captions, alt text). Each draft is a request, checked again when it arrives and when you accept it.</li>
          <li><strong>You review and post</strong> in sNeek: Approvals › Agent requests › Approve makes a draft in Social posts marked &quot;drafted by an agent&quot;. You edit it, tick that you looked at every photo, then post. Claude never posts.</li>
        </ol>
      </ECard>

      <ECard className="space-y-2 p-4">
        <h2 className="text-[0.9375rem] font-[600]">The AI features behind caption help</h2>
        <div role="region" aria-label="AI features" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-[0.8125rem]">
            <thead className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]"><tr><th className="py-1.5 pr-3 font-[550]">Feature</th><th className="py-1.5 pr-3 font-[550]">Runs on</th><th className="py-1.5 pr-3 font-[550]">Photos may leave the server</th><th className="py-1.5 font-[550]">Per hour</th></tr></thead>
            <tbody>
              {([["Social post drafts (text_compose)", textRoute], ["Social photo captions (social_post)", photoRoute]] as const).map(([label, route]) => (
                <tr key={label} className="border-t border-[hsl(var(--e-border))]">
                  <td className="py-1.5 pr-3">{label}</td>
                  <td className="py-1.5 pr-3">{route ? route.text : "not readable"}</td>
                  <td className="py-1.5 pr-3">{route ? route.photos : "not readable"}</td>
                  <td className="py-1.5 e-tnum">{route ? route.perHour : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Same provider layer, audit (no prompt, no image bytes) and refusals as every other feature; change them in <a className="underline" href="/v2/admin/ai">AI configuration</a>. &quot;social_post&quot; only ever receives the cropped copy, never an evidence original. If AI is off: &quot;AI caption help is off. Templates still work.&quot;</p>
      </ECard>

      <ECard className="space-y-2 p-4">
        <h2 className="text-[0.9375rem] font-[600]">Checked on Anthropic&apos;s pages (15 Nov 2026), and what could not be confirmed</h2>
        <ul className="list-disc space-y-1 pl-5 text-[0.8125rem]">
          <li>Claude Code signs in with a Pro or Max login; its usage limits are shared with Claude chats. The subscription and the API are billed separately.</li>
          <li>Subscription sign-in is for Claude Code and Anthropic&apos;s own apps; third parties may not route requests through plan credentials or store Claude sessions.</li>
          <li>Custom connectors (remote MCP) are on Free (one), Pro, Max, Team and Enterprise, on web and desktop, and can send fixed credentials as request headers.</li>
          <li>Not confirmed: the Claude app connector end to end with sNeek; how many drafting runs a plan allows; whether a phone can add the connector; qwen3:4b speed on your server.</li>
        </ul>
      </ECard>
    </div>
  );
}
