"use client";

/** Settings › Property reminder rules: the rules, then the Reminder suggestions queue, refreshed together. */
import * as React from "react";
import { ReminderRules } from "./reminder-rules";
import { ReminderSuggestions } from "./reminder-suggestions";

export function ReminderRulesWorkspace({ timeZone }: { timeZone: string }) {
  const [rulesVersion, setRulesVersion] = React.useState(0);
  const [queueVersion, setQueueVersion] = React.useState(0);
  return (
    <div className="space-y-8">
      <ReminderSuggestions refreshKey={queueVersion} onRuleChanged={() => setRulesVersion((value) => value + 1)} />
      <section aria-labelledby="reminder-rules-title" className="space-y-3">
        <h2 id="reminder-rules-title" className="text-[1rem] font-[650]">Automatic rules</h2>
        <ReminderRules timeZone={timeZone} refreshKey={rulesVersion} onChanged={() => setQueueVersion((value) => value + 1)} />
      </section>
    </div>
  );
}
