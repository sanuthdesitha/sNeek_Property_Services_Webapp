/**
 * "What each mode can do" (board "Test as"). Rendered from TEST_AS_RULES,
 * which names the server's enforcement points (tests/lib/test-as-rules.test.ts
 * ties the two), so the table cannot drift into hand-written prose.
 *
 * Plain module (no "use client"): the server page renders it.
 */
import { ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import { TEST_AS_RULES, type TestAsAnswer } from "@/lib/auth/test-as-rules";

const ANSWER_CLASS: Record<TestAsAnswer["kind"], string> = {
  yes: "text-[hsl(var(--e-band-good-pill))]",
  real: "text-[hsl(var(--e-band-good-pill))]",
  refused: "text-[hsl(var(--e-band-problem-pill))]",
  not_recorded: "text-[hsl(var(--e-band-problem-pill))]",
  no: "text-[hsl(var(--e-band-problem-pill))]",
};

function Answer({ answer }: { answer: TestAsAnswer }) {
  return <span className={cn("font-[600]", ANSWER_CLASS[answer.kind])}>{answer.words}</span>;
}

export function TestAsModeTable() {
  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[0.9375rem]">What each mode can do</ECardTitle>
      </ECardHeader>
      <ECardBody className="pt-0">
        <div role="region" aria-label="What each mode can do" className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.8125rem]">
            <thead>
              <tr className="bg-[hsl(var(--e-surface-sunken))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                <th scope="col" className="px-2 py-2 font-[500]"><span className="sr-only">What</span></th>
                <th scope="col" className="w-[24%] px-2 py-2 font-[500]">View only</th>
                <th scope="col" className="w-[30%] px-2 py-2 font-[500]">Full access</th>
              </tr>
            </thead>
            <tbody>
              {TEST_AS_RULES.map((rule) => (
                <tr key={rule.key} className="border-b border-[hsl(var(--e-border))] align-top last:border-b-0">
                  <th scope="row" className="px-2 py-2 font-[400] text-[hsl(var(--e-foreground))]">{rule.label}</th>
                  <td className="px-2 py-2"><Answer answer={rule.viewOnly} /></td>
                  <td className="px-2 py-2"><Answer answer={rule.full} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Each &ldquo;Refused&rdquo; says why in words, never a bare error code.</p>
      </ECardBody>
    </ECard>
  );
}
