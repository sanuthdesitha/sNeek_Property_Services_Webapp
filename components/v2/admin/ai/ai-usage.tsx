"use client";

/**
 * Section 4, "Usage and cost": this month by feature and model from the AI
 * call log, and the owner-entered model prices that drive the estimate. A
 * model without a price is "Not known", never $0; Local Ollama has no
 * provider charge.
 */
import * as React from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import { AI_FEATURE_CATALOG, AI_PROVIDER_KINDS, type AiFeature, type AiModelPrice, type AiProviderKind } from "@/lib/ai/provider/routing-schema";
import { count, millions, money, monthFigure, shortProviderName, type AiPage, type UsageRow } from "./ai-config-model";
import { AI_FIELD, AI_MUTED, AiSectionHeading } from "./ai-ui";

function costCell(row: UsageRow): { text: string; unknown: boolean } {
  if (row.provider === "ollama") return { text: "No provider charge", unknown: false };
  if (row.unknownCostCalls > 0 && row.knownCostMicroUsd === 0) return { text: "Not known", unknown: true };
  if (row.unknownCostCalls > 0) return { text: `${money(row.knownCostMicroUsd)} + ${count(row.unknownCostCalls)} Not known`, unknown: true };
  return { text: money(row.knownCostMicroUsd), unknown: false };
}

function featureName(feature: string): string {
  return AI_FEATURE_CATALOG[feature as AiFeature]?.label ?? feature;
}

function hasPrice(prices: AiModelPrice[], provider: string, model: string): boolean {
  return prices.some((price) => price.provider === provider && price.model === model);
}

export function UsageSection({ page }: { page: AiPage }) {
  const usage = page.state.usage;
  const prices = page.draft.prices;
  const addPrice = (provider: AiProviderKind, model: string) => page.setDraft((old) => ({ ...old, prices: [...old.prices, { provider, model, inputUsdPerMillion: 0, outputUsdPerMillion: 0 }] }));
  const total = monthFigure(usage, () => true);
  return (
    <section aria-labelledby="ai-usage-heading" id="usage" className="min-w-0 space-y-3 scroll-mt-24">
      <AiSectionHeading id="ai-usage-heading" number={4} title="Usage and cost" aside={usage ? `${usage.monthLabel} so far, from the AI call log, counted in ${usage.timezone}. Estimates from the prices below, in US dollars.` : undefined} />
      <div className="flex min-w-0 flex-col gap-3 2xl:flex-row 2xl:items-start">
        <ECard className="min-w-0 flex-1 overflow-hidden">
          {!usage ? (
            <p role="alert" className="p-4 text-[0.8125rem]">This month&apos;s AI usage could not be read. Settings above still work.</p>
          ) : usage.rows.length === 0 ? (
            <p className="p-4 text-[0.8125rem]">No AI requests this month.</p>
          ) : (
            <>
              <div role="region" aria-label="Usage this month" tabIndex={0} className="overflow-x-auto max-sm:hidden">
                <table className="w-full min-w-[40rem] text-left text-[0.8125rem]">
                  <thead className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                    <tr><th scope="col" className="px-3 py-2 font-semibold">Feature</th><th scope="col" className="px-3 py-2 font-semibold">Provider · model</th><th scope="col" className="px-3 py-2 text-right font-semibold">Requests</th><th scope="col" className="px-3 py-2 text-right font-semibold">Tokens in / out</th><th scope="col" className="px-3 py-2 text-right font-semibold">Estimated cost</th></tr>
                  </thead>
                  <tbody>
                    {usage.rows.map((row) => {
                      const cost = costCell(row);
                      return (
                        <tr key={`${row.feature}-${row.provider}-${row.model}`} className="border-b border-[hsl(var(--e-border))] align-top">
                          <td className="px-3 py-2">{featureName(row.feature)}</td>
                          <td className="break-words px-3 py-2 [overflow-wrap:anywhere]">{row.provider === "ollama" ? "Local" : shortProviderName(row.provider, page.draft)} · {row.model}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{count(row.calls)}<div className={cn("text-[0.6875rem]", AI_MUTED)}>{row.succeeded} ok · {row.failed} failed · {row.refused} refused</div></td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{millions(row.inputTokens)} / {millions(row.outputTokens)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span className={cost.unknown ? "font-semibold text-[hsl(var(--e-warning))]" : undefined}>{cost.text}</span>
                            {cost.unknown && page.canEdit && row.provider !== "ollama" && !hasPrice(prices, row.provider, row.model) && AI_PROVIDER_KINDS.includes(row.provider as AiProviderKind) ? (
                              <> <button type="button" className="text-[0.75rem] underline" disabled={page.locked} onClick={() => addPrice(row.provider as AiProviderKind, row.model)}>Add a price</button></>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {total ? (
                      <tr className="bg-[hsl(var(--e-surface-raised))] font-semibold">
                        <td className="px-3 py-2" colSpan={2}>Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">{count(total.requests)}</td>
                        <td />
                        <td className="px-3 py-2 text-right tabular-nums">{money(total.knownMicroUsd)}{total.unknownCalls ? <div className="text-[0.75rem]">+ {count(total.unknownCalls)} requests Not known</div> : null}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <ul aria-label="Usage this month" className="sm:hidden">
                {usage.rows.map((row) => {
                  const cost = costCell(row);
                  return (
                    <li key={`${row.feature}-${row.provider}-${row.model}`} className="flex items-start justify-between gap-3 border-t border-[hsl(var(--e-border))] px-3 py-2.5 text-[0.8125rem] first:border-0">
                      <span className="min-w-0"><b className="block">{featureName(row.feature)}</b><span className={cn("block text-[0.71875rem] [overflow-wrap:anywhere]", AI_MUTED)}>{row.provider === "ollama" ? "Local" : shortProviderName(row.provider, page.draft)} · {row.model} · {count(row.calls)} requests</span></span>
                      <span className={cn("shrink-0 text-right tabular-nums", cost.unknown && "font-semibold text-[hsl(var(--e-warning))]")}>{cost.text}</span>
                    </li>
                  );
                })}
                {total ? <li className="flex justify-between gap-3 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5 text-[0.8125rem] font-semibold"><span>Total · {count(total.requests)} requests</span><span className="text-right">{money(total.knownMicroUsd)}{total.unknownCalls ? <span className="block text-[0.75rem]">+ {count(total.unknownCalls)} Not known</span> : null}</span></li> : null}
              </ul>
            </>
          )}
          {usage ? <p className={cn("border-t border-[hsl(var(--e-border))] px-3 py-2 text-[0.71875rem]", AI_MUTED)}>Refused requests (switched off, not configured, photos not allowed, hourly limit) never reached a provider.</p> : null}
        </ECard>
        <PricesCard page={page} onAdd={() => addPrice("anthropic", "claude-sonnet-5")} />
      </div>
    </section>
  );
}

function PricesCard({ page, onAdd }: { page: AiPage; onAdd: () => void }) {
  const prices = page.draft.prices;
  const missing = (page.state.usage?.rows ?? []).filter((row) => row.provider !== "ollama" && !hasPrice(prices, row.provider, row.model));
  const update = (index: number, patch: Partial<AiModelPrice>) => page.setDraft((old) => ({ ...old, prices: old.prices.map((price, i) => (i === index ? { ...price, ...patch } : price)) }));
  return (
    <ECard className="flex min-w-0 flex-col gap-2.5 p-4 2xl:w-[24rem] 2xl:flex-none">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[0.9375rem] font-semibold">Model prices</h3>
        {page.canEdit ? <EButton type="button" size="sm" variant="outline" disabled={page.locked || prices.length >= 50} onClick={onAdd}>+ Add a price</EButton> : null}
      </div>
      {prices.length === 0 && missing.length === 0 ? <p className="text-[0.8125rem]">No prices entered.</p> : null}
      <ul className="space-y-2">
        {prices.map((price, index) => (
          <li key={index} className="grid grid-cols-2 gap-1.5 border-t border-[hsl(var(--e-border))] pt-2 first:border-0 first:pt-0">
            <select aria-label={`Provider for price ${index + 1}`} className={AI_FIELD} value={price.provider} disabled={page.locked} onChange={(event) => update(index, { provider: event.target.value as AiProviderKind })}>
              {AI_PROVIDER_KINDS.filter((provider) => provider !== "ollama").map((provider) => <option key={provider} value={provider}>{shortProviderName(provider, page.draft)}</option>)}
            </select>
            <input aria-label={`Model for price ${index + 1}`} className={cn(AI_FIELD, "font-mono")} value={price.model} disabled={page.locked} spellCheck={false} autoComplete="off" onChange={(event) => update(index, { model: event.target.value })} />
            <label className="text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">In $/M
              <input type="number" inputMode="decimal" min={0} max={1000} step="0.01" className={cn(AI_FIELD, "tabular-nums")} value={Number.isFinite(price.inputUsdPerMillion) ? price.inputUsdPerMillion : ""} disabled={page.locked} onChange={(event) => update(index, { inputUsdPerMillion: Number(event.target.value) })} />
            </label>
            <label className="text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">Out $/M
              <input type="number" inputMode="decimal" min={0} max={1000} step="0.01" className={cn(AI_FIELD, "tabular-nums")} value={Number.isFinite(price.outputUsdPerMillion) ? price.outputUsdPerMillion : ""} disabled={page.locked} onChange={(event) => update(index, { outputUsdPerMillion: Number(event.target.value) })} />
            </label>
            {page.canEdit ? <EButton type="button" size="sm" variant="ghost" className="col-span-2 justify-self-end" disabled={page.locked} onClick={() => page.setDraft((old) => ({ ...old, prices: old.prices.filter((_, i) => i !== index) }))}>Remove price</EButton> : null}
          </li>
        ))}
        {missing.map((row) => (
          <li key={`missing-${row.provider}-${row.model}`} className="flex items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-2 text-[0.75rem]">
            <span className="min-w-0 break-all font-mono">{row.model}</span>
            <span className="font-semibold text-[hsl(var(--e-warning))]">Not known</span>
          </li>
        ))}
      </ul>
      <p className={cn("text-[0.71875rem]", AI_MUTED)}>Enter the provider&apos;s own price in US dollars per million tokens. A model without a price shows &quot;Not known&quot;, never $0. A new price applies to requests from then on.</p>
    </ECard>
  );
}
