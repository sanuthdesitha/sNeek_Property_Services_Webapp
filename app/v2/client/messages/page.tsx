import { EButton, ECard, ECardBody, EPageHeader, EThread } from "@/components/v2/ui/primitives";
import { Send } from "lucide-react";

export const metadata = { title: "Messages · Estate client" };

const THREAD = [
  { from: "ops", name: "sNeek Ops", text: "Hi James — Ana is confirmed for tomorrow's turnover at 9am. Anything to note?", time: "9:14 AM" },
  { from: "me", name: "You", text: "All good, thanks. The lockbox code changed to 4821.", time: "9:20 AM" },
  { from: "ops", name: "sNeek Ops", text: "Noted and updated on the job. Have a lovely day.", time: "9:21 AM" },
];

export default function ClientMessagesPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Support" title="Messages" description="Talk directly with the ops team." />
      <ECard>
        <ECardBody className="space-y-4 pt-6">
          {THREAD.map((m, i) => (
            <div key={i} className={m.from === "me" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  "max-w-[75%] rounded-[var(--e-radius-lg)] px-4 py-2.5 text-[0.875rem] " +
                  (m.from === "me"
                    ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                    : "border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]")
                }
              >
                <p>{m.text}</p>
                <p className={"mt-1 text-[0.6875rem] " + (m.from === "me" ? "text-[hsl(var(--e-primary-foreground)/0.7)]" : "text-[hsl(var(--e-text-faint))]")}>{m.time}</p>
              </div>
            </div>
          ))}
          <EThread />
          <div className="flex items-center gap-2">
            <div className="h-10 flex-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.875rem] text-[hsl(var(--e-text-faint))]">
              Write a message…
            </div>
            <EButton variant="gold" size="icon"><Send className="h-4 w-4" /></EButton>
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
