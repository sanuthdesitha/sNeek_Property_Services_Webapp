"use client";

import type { WebsiteContent, WebsiteWhyItem, WebsiteFaqItem } from "@/lib/public-site/content";
import type { SectionProps } from "../types";
import {
  ESectionCard,
  EListItem,
  EAddRow,
  EField,
  EInput,
  ETextarea,
  moveItem,
  uid,
} from "../shared";
import { ESelectNative } from "@/components/v2/admin/settings/estate-form";

const FAQ_CATEGORIES: WebsiteFaqItem["category"][] = ["booking", "pricing", "services", "trust", "airbnb"];

export function WhyFaqSection({ content, setContent, readOnly }: SectionProps) {
  const setWhy = (p: Partial<WebsiteContent["whyChooseUs"]>) =>
    setContent((c) => ({ ...c, whyChooseUs: { ...c.whyChooseUs, ...p } }));
  const setFaq = (p: Partial<WebsiteContent["faq"]>) =>
    setContent((c) => ({ ...c, faq: { ...c.faq, ...p } }));

  const why = content.whyChooseUs;
  const faq = content.faq;

  const patchWhy = (i: number, p: Partial<WebsiteWhyItem>) =>
    setWhy({ items: why.items.map((row, idx) => (idx === i ? { ...row, ...p } : row)) });
  const patchFaq = (i: number, p: Partial<WebsiteFaqItem>) =>
    setFaq({ items: faq.items.map((row, idx) => (idx === i ? { ...row, ...p } : row)) });

  return (
    <div className="space-y-5">
      <ESectionCard title="Why choose us">
        <EField label="Section title">
          <EInput value={why.title} disabled={readOnly} onChange={(e) => setWhy({ title: e.target.value })} />
        </EField>
        <EField label="Section intro">
          <ETextarea rows={3} value={why.intro} disabled={readOnly} onChange={(e) => setWhy({ intro: e.target.value })} />
        </EField>
        <EAddRow
          hint="Reason cards (icon name, title, description)"
          label="Add reason"
          disabled={readOnly}
          onAdd={() =>
            setWhy({ items: [...why.items, { id: uid("why"), icon: "ShieldCheck", title: "New reason", description: "Describe why clients choose you." }] })
          }
        />
        {why.items.map((item, index) => (
          <EListItem
            key={item.id}
            index={index}
            count={why.items.length}
            title={item.title || `Reason ${index + 1}`}
            disabled={readOnly}
            onMoveUp={() => setWhy({ items: moveItem(why.items, index, -1) })}
            onMoveDown={() => setWhy({ items: moveItem(why.items, index, 1) })}
            onRemove={() => setWhy({ items: why.items.filter((_, i) => i !== index) })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <EField label="Icon name" hint="Any lucide-react icon, e.g. ShieldCheck, Camera, MapPin.">
                <EInput value={item.icon} disabled={readOnly} onChange={(e) => patchWhy(index, { icon: e.target.value })} />
              </EField>
              <EField label="Title">
                <EInput value={item.title} disabled={readOnly} onChange={(e) => patchWhy(index, { title: e.target.value })} />
              </EField>
            </div>
            <EField label="Description">
              <ETextarea rows={2} value={item.description} disabled={readOnly} onChange={(e) => patchWhy(index, { description: e.target.value })} />
            </EField>
          </EListItem>
        ))}
      </ESectionCard>

      <ESectionCard title="FAQ">
        <EField label="Section title">
          <EInput value={faq.title} disabled={readOnly} onChange={(e) => setFaq({ title: e.target.value })} />
        </EField>
        <EField label="Section intro">
          <ETextarea rows={2} value={faq.intro} disabled={readOnly} onChange={(e) => setFaq({ intro: e.target.value })} />
        </EField>
        <EAddRow
          hint="FAQ items (question, answer, category)"
          label="Add FAQ"
          disabled={readOnly}
          onAdd={() =>
            setFaq({ items: [...faq.items, { id: uid("faq"), question: "New question?", answer: "Answer here.", category: "booking" }] })
          }
        />
        {faq.items.map((item, index) => (
          <EListItem
            key={item.id}
            index={index}
            count={faq.items.length}
            title={item.question || `FAQ ${index + 1}`}
            disabled={readOnly}
            onMoveUp={() => setFaq({ items: moveItem(faq.items, index, -1) })}
            onMoveDown={() => setFaq({ items: moveItem(faq.items, index, 1) })}
            onRemove={() => setFaq({ items: faq.items.filter((_, i) => i !== index) })}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
              <EField label="Question">
                <EInput value={item.question} disabled={readOnly} onChange={(e) => patchFaq(index, { question: e.target.value })} />
              </EField>
              <EField label="Category">
                <ESelectNative
                  value={item.category}
                  disabled={readOnly}
                  onChange={(e) => patchFaq(index, { category: e.target.value as WebsiteFaqItem["category"] })}
                >
                  {FAQ_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </ESelectNative>
              </EField>
            </div>
            <EField label="Answer">
              <ETextarea rows={3} value={item.answer} disabled={readOnly} onChange={(e) => patchFaq(index, { answer: e.target.value })} />
            </EField>
          </EListItem>
        ))}
      </ESectionCard>
    </div>
  );
}
