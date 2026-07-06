# Rebrand Doc 03 — Unified Template System & Layout Editor Architecture

> Planning report (Fable 5, 2026-07-04). Scope: every outbound artifact (emails, invoices ×3, quotes, client reports, QA reports, laundry documents, SMS, PDF checklists) onto one block-based template model + a drag-and-drop layout editor. See `00-MASTER-PLAN.md` for the synthesis.

## 0. Current-state audit (what the plan must respect)

### 0.1 Rendering systems found (six parallel ones today)

| System | Files | Approach |
|---|---|---|
| App emails (30 template keys) | `lib/email-templates.ts` (1,015 lines) | Hand-built string HTML, `{var}` single-brace interpolation, luxury palette hardcoded, `wrapEmailHtml()` shell |
| Finance/event notifications (50 event keys) | `lib/notification-templates.ts` (673 lines), `lib/notifications/events.ts`, Prisma `NotificationTemplate` | DB-overridable subject/body/SMS/push per event, `{{var}}` double-brace, edited at `/admin/notifications?tab=templates` |
| Block email designer (nascent) | `lib/templates/email-blocks.ts` | 6 block types → table HTML with design JSON round-tripped in an HTML comment (`SNEEK_EMAIL_DESIGN:` marker) |
| Documents (HTML→PDF) | `lib/billing/client-invoices.ts`, `lib/cleaner/invoice.ts`, `lib/laundry/invoice.ts` (+ per-user 3-field template in AppSetting), `lib/pricing/quote-report.ts`, `lib/reports/generator.ts` (883 lines), `lib/reports/qa-report.ts`, `lib/checklists/checklist-pdf.ts` | Independent string-built HTML per document; all funnel into `lib/reports/pdf.ts` `renderPdfFromHtml()` (Playwright Chromium, single-flight semaphore, sharp image downscaling, S3 upload) |
| Cleaner job forms | `lib/forms/template-schema.ts`, `lib/forms/visibility.ts`, `lib/checklists/*` (library → `composeFormSchema` → per-property versioned `FormTemplate`), builder — **already dnd-kit** | JSON sections/fields with conditionals on answers AND property features; submissions snapshot the schema as `__templateSchema`; report rendering prefers the snapshot |
| SMS | `lib/notifications/sms.ts` (Twilio/Cellcast, AU E.164, 459-char clamp) | Plain text bodies from `NotificationTemplate.smsBody` / `MessageTemplate.body` |

### 0.2 Gating & invariants that must survive

- **Email automation gating** — chokepoint `sendEmailDetailed()`: `payload.kind` (20 `EMAIL_AUTO_KINDS`) gated by master + per-kind switches; `transactional` bypasses suppression. **The chokepoint contract (`to/subject/html/kind/transactional/attachments`) is the compatibility boundary.**
- **Report snapshots** — `__templateSchema` embedded at submit time; `generatePropertyTemplates()` versions + archives because past reports rely on snapshots. The new system must reproduce snapshot-at-use.
- **Invoice immutability** — point-in-time `ClientInvoiceLine` rows; VOID not delete; Xero push + CSV consume **structured data, not rendered HTML** — restyling is safe, data model is not.
- **The templates hub is already retired** — templates live under their domain pages; the new editor follows that IA (a hub *listing* is fine; editing stays in context).
- **Two interpolation dialects coexist** (`{var}` vs `{{var}}`) — unify with back-compat.
- **Dependency facts:** `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10` in use; `react-hook-form@7.53.2` + `zod@3.23.8` installed but **RHF imported nowhere** (all forms hand-rolled `useState`); `zustand@5`, `@tanstack/react-query@5`, Radix, Playwright PDF, Resend, Twilio/Cellcast. No Formik, no RJSF, no react-beautiful-dnd.

## 1. Unified template model

### 1.1 Design principle

**One JSON document model, four renderers, one brand-token source.** A `TemplateDoc` is a channel-agnostic block tree. Renderers are pure functions `(doc, data, brand, channelOpts) → output`:

- `renderEmail` → table-based, inline-styled, 600px email HTML (extends the proven `email-blocks.ts` approach)
- `renderPdf` → semantic A4 HTML + print CSS → existing `renderPdfFromHtml()` — **do not replace the PDF engine**
- `renderWeb` → React components for portal viewing / live preview (shares block components with the editor canvas)
- `renderText` → plain text for SMS bodies and email text-parts (SMS templates are single-`textBlock` docs with a segment budget)

### 1.2 Core types (new `lib/templates/model.ts`)

```ts
type Channel = "email" | "pdf" | "web" | "sms";

interface TemplateDoc {
  version: 2;                        // model version, distinct from content version
  kind: TemplateKind;                // "email.jobAssigned" | "doc.clientInvoice" | "sms.jobReminder" | ...
  page: { size?: "A4"; margin?: string; background: TokenRef | string };
  theme: ThemeOverride;              // per-template overrides on brand tokens
  blocks: Block[];
}

interface BlockBase {
  id: string;
  type: BlockType;
  when?: MergeExpr;                  // conditional rendering, e.g. "invoice.gstEnabled"
  channels?: Channel[];              // omit = all channels this kind targets
  style?: Partial<BlockStyle>;       // token-referencing style overrides
}
```

### 1.3 Block taxonomy

Registry-driven (`lib/templates/blocks/registry.ts`): each block declares `type`, `propsSchema` (zod), `allowedKinds`, `allowedChannels`, defaults, and one renderer per channel. Adding a block = one folder, no editor changes.

| Block | Purpose / key props | Channels |
|---|---|---|
| `header` | Logo, company name, document eyebrow ("TAX INVOICE"), doc number + date; variants `email` / `document` letterhead | all |
| `hero` | Large serif headline + subline + gold rule; email hero uses bulletproof bg color | email, web |
| `heading` / `text` / `richText` | Typographic blocks; `richText` = constrained marks stored as minimal JSON, not HTML | all |
| `statRow` | 2–4 KPI tiles (label, value, delta) — briefings, summaries, money digests | all |
| `infoCard` (kvTable) | Label/value rows — job details, banking details; replaces today's `infoBox()` | all |
| `lineItems` | Table bound to array path (`{{invoice.lines}}`); column defs (label, path, format, align); groupBy; pdf repeats header per page | pdf, web, email(simplified) |
| `totals` | Subtotal / GST / adjustments / grand total, right-aligned ledger with gold-rule total; binds to computed totals — **never recomputes money** | pdf, web, email |
| `terms` | Legal text with per-kind default copy | pdf, web |
| `signature` | Signature image or signing line + name/role/date | pdf, web |
| `photoGrid` | Media grid bound to media arrays; columns, max, caption, "evidence" badge; pdf enforces the image pipeline | pdf, web, email(linked thumbnails) |
| `checklistSection` | Renders a form-schema section + answers: ✓/✗, value, note, evidence; **consumes the exact `__templateSchema` shape + visibility rules** (wraps `buildChecklistHtml` logic) | pdf, web |
| `qaScoreCard` | QA verdict, score ring, category breakdown, rework flags | pdf, web |
| `button` (CTA) | Bulletproof email button; hidden in pdf unless `showUrlInPdf` | email, web |
| `alert` / `callout` | Tinted notice (info/success/warning/urgent) | all |
| `image`, `divider`, `spacer`, `columns` (2-col max, stacks on mobile/email) | Layout primitives | all |
| `pageBreak` | Explicit break + `keepTogether` hint | pdf |
| `footer` | Contact, ABN, unsubscribe slot (auto-injected for kind-gated emails), page numbers on pdf | all |
| `textBlock` (sms) | Plain text + merge fields, live segment counter | sms |

### 1.4 Brand tokens

New single source `lib/brand/tokens.ts`:

```ts
interface BrandTokens {
  color: { primary; ink; surface; accent; success; warning; danger; muted; rule };
  font:  { display: string; body: string };   // email-safe stacks: Georgia serif / system sans
  radius: { card; chip }; spacing: scale; logo: { url; darkUrl };
  identity: { companyName; abn; address; accountsEmail; supportEmail; phone };
}
resolveBrandTokens(settings: AppSettings): BrandTokens
```

Read from `AppSettings` so the rebrand is data, not code. Web/pdf renderers emit CSS custom properties; the email renderer resolves tokens to literal hex inline (Gmail/Outlook). Blocks reference tokens (`"color.accent"`), never hex; per-template `theme` overrides merge at render time. **When the Estate design system lands (doc 02), these tokens carry it to every template automatically.**

### 1.5 Merge-field / variable system

- **Syntax:** `{{path.to.value}}` with pipe formatters: `{{invoice.total | money}}`, `{{job.scheduledDate | date:"EEE d MMM"}}`, `{{client.name | fallback:"there"}}`. Double-brace everywhere; the resolver **also accepts legacy `{var}`** during migration.
- **Formatters** (`lib/templates/formatters.ts`): `money` (en-AU AUD — fixes "caller must pre-format"), `date`/`time`/`datetime` (settings tz), `number`, `plural`, `upper`, `fallback`, `join`. Extensible registry.
- **Data contracts:** every `TemplateKind` declares a zod-typed context. The contract drives (a) the editor's variable picker with types + sample values, (b) render-time validation, (c) publish-time linting for unknown paths. Existing variable lists become generated views of these contracts.
- **Escaping:** resolved values HTML-escaped by default; `richText` sanitized; a raw-HTML escape hatch exists only for two migration-era blocks (§5), admin-invisible in the editor.

### 1.6 Versioning & snapshots

New Prisma models:

```
TemplateDefinition  id, kind (unique per scope), name, scope ("SYSTEM"|"CLIENT:{id}"|"USER:{id}"),
                    publishedVersionId?, updatedAt
TemplateVersion     id, definitionId, version (int), doc (Json), status (DRAFT|PUBLISHED|ARCHIVED),
                    label?, createdById, createdAt, publishedAt?   @@unique([definitionId, version])
RenderedDocument    id, kind, entityType/entityId, templateVersionId,
                    docSnapshot (Json), dataSnapshot (Json), htmlKey?/pdfKey? (S3), renderedAt
```

Rules, mirroring today's guarantees:
1. **Publish is append-only.** Editing creates a new DRAFT; publishing flips the pointer; old versions never mutate (same philosophy as `FormTemplate.version` + `parentTemplateId`).
2. **Documents snapshot at issue time.** Invoice approved/sent, quote sent, report generated → persist `RenderedDocument` with resolved doc + data (+ PDF to S3). Re-viewing renders from the snapshot — the generalized `__templateSchema` pattern. Template edits never change issued paper.
3. **Form submissions keep embedding `__templateSchema` exactly as now** — the `checklistSection` block *reads* that snapshot; submission storage unchanged.
4. **Emails snapshot into the send log** (`Notification`/`NotificationLog` gain `templateVersionId`).

## 2. Library decisions

### 2.1 Form state: **React Hook Form + zodResolver** — adopt for ALL app forms. Not Formik.

- Already installed and philosophically aligned: RHF 7.53 + zod 3.23 in package.json; zod already validates template schemas, API inputs, settings. Formik would add a second validation idiom (Yup-centric).
- **Formik is effectively unmaintained** — no meaningful release since 2023; controlled-input architecture re-renders whole forms per keystroke. RHF is uncontrolled/subscription-based (~10 kB), actively maintained; `useFieldArray` is exactly what line-item and block-list inspectors need.
- Against the status quo: zero RHF imports — every admin form re-implements dirty-tracking/errors/submit-state by hand. Standardize via a thin kit (`components/forms/rhf/`: `<Form schema>`, `<Field>`, `<SubmitButton>` bound to existing Radix/Tailwind inputs). **Adopt incrementally:** mandatory for new surfaces (the whole editor inspector is RHF); migrate existing forms when touched — no big-bang.

### 2.2 RJSF: **do not adopt** — keep and harden the in-house form engine.

- The app owns a production JSON form engine with semantics RJSF can't express without heavy customization: photo fields with `minPhotos`/`stampTag`, reveal instructions with media references, signature capture, one-level `children`, dual-source conditionals (answers AND property features). The checklist-library composer emits this shape; report generator + `__templateSchema` snapshots depend on it.
- Wrapping = maintaining a lossy bidirectional translation forever + RJSF's weight (~60–100 kB themed) + a validation-first data model with no concept of media evidence. Replacement = invalidating every stored template, snapshot, and the compose pipeline. Both lose.
- Where RJSF *would* have helped — schema-driven settings panels — the block registry's zod `propsSchema` + auto-generated RHF inspector delivers the same benefit inside our design system. **RJSF: no role.**

### 2.3 Drag-and-drop: **dnd-kit everywhere.**

- **react-beautiful-dnd is deprecated — ruled out flat.** Atlassian archived it (EOL 2024, repo read-only since mid-2025); no React 18 Strict Mode without patches. The `@hello-pangea/dnd` fork inherits the list-only model. Do not introduce in 2026.
- **Pragmatic Drag and Drop**: excellent performance (native HTML5 DnD, headless, ~4.7 kB entry). Honest evaluation: **no sortable preset and no a11y out of the box** — reordering, drop indicators, keyboard flows, SR announcements are all assemble-yourself. Best-in-class for cross-window/iframe drags and virtualized boards — which we don't need.
- **dnd-kit wins on situation and merit:** already powers the form builder (`DndContext`, Pointer+Keyboard sensors, `DragOverlay`, palette-to-canvas drops) and the client-invoices page. Working patterns exist for exactly the interactions the template editor needs. ~10–12 kB already paid. Built-in keyboard sensor + `announcements`. Maintenance caveat acknowledged (release cadence slowed; "dnd kit x" rewrite not production-ready) — v6 is stable and pinned. Revisit Pragmatic only if a virtualized mega-board demands it.

**Recommendation set:**

| Concern | Choice |
|---|---|
| (a) Template/layout editor | **dnd-kit** (core + sortable, vertical list + palette drops) |
| (b) Form builder | **dnd-kit** — already implemented; extend |
| (c) Kanban boards | **dnd-kit** multi-container sortable |
| All app forms + editor inspector | **React Hook Form + zodResolver** |
| Schema-driven form rendering | **In-house engine** (kept); **no RJSF** |
| Editor state | **zustand** temporal (undo/redo) slice |

## 3. Layout editor specification

### 3.1 UX — one editor, four panes (generalization of the existing form builder)

```
┌────────────┬──────────────────────────────┬─────────────────┐
│ PALETTE    │ CANVAS                       │ INSPECTOR       │
│ blocks     │ (block stack, dnd-kit        │ (RHF form from  │
│ filtered   │  sortable; selection ring;   │  selected block │
│ by kind;   │  insert-between affordance;  │  propsSchema;   │
│ saved      │  live sample-data render     │  style tab w/   │
│ "sections" │  through the REAL renderer)  │  token pickers; │
│ presets    │                              │  `when` rules)  │
├────────────┴──────────────────────────────┴─────────────────┤
│ TOPBAR: kind switcher · breakpoint (Mobile 375 / Email 600 / │
│ A4 / Desktop) · sample-data selector · Theme · History ·     │
│ autosave status · Preview/Test-send · Publish                │
└──────────────────────────────────────────────────────────────┘
```

- **Palette:** registry filtered by `allowedKinds`; drag-in or click-to-append; "Layouts" tab with saved multi-block section presets.
- **Canvas = the real renderer** with editing chrome overlaid: email kinds render actual table HTML in a sandboxed iframe at 600px; document kinds render A4 pages with simulated `pageBreak` positions and repeated `lineItems` headers. What you see is what ships.
- **Inspector:** auto-generated from the block's zod `propsSchema` via the RHF kit; special editors per prop type: rich-text mini-editor, **variable picker** (typed tree from the kind's data contract, searchable, inserts `{{...}}` chips with sample value + formatter menu), column editor for `lineItems`, condition builder for `when`, image picker.
- **Theme tab:** per-template `ThemeOverride` (accent, header treatment, email-safe font whitelist, density, logo variant) — mirrors the form builder's theme-editor precedent.
- **Sample-data preview:** canned fixtures + "load a recent real record" (admin-only, PII-aware). Unresolved variables = red chips in the editor, empty-safe fallbacks in production.
- **Breakpoints:** Mobile 375 / Email 600 / A4 print / Desktop; email mode offers a dark-mode simulation filter.
- **Autosave + history:** debounced (~2 s) PATCH into the DRAFT version; local undo/redo (zustand temporal, Ctrl+Z); History drawer with visual diff-by-preview and one-click **Restore as new draft**. **Publish** = lint (unknown variables, missing required blocks, email-safety) then flip `publishedVersionId`.
- **Test output:** "Send test email to me" (via `sendEmailDetailed`, no kind → ungated), "Download sample PDF".
- **A11y:** dnd-kit keyboard sensor for full keyboard reordering, `announcements`, focus-visible selection, labeled Radix inputs.

### 3.2 Editor state model

```ts
interface EditorState {
  definitionId: string; kind: TemplateKind;
  doc: TemplateDoc;
  selection: { blockId: string | null };
  history: { past: TemplateDoc[]; future: TemplateDoc[] };
  sample: { source: "fixture" | "record"; recordId?: string; data: unknown };
  viewport: "mobile" | "email" | "a4" | "desktop";
  save: { status: "saved" | "saving" | "dirty" | "error"; lastSavedAt?: string; serverVersion: number };
}
```

Persistence: `GET/PATCH /api/admin/template-defs/[id]/draft`, `POST .../publish`, `GET .../versions`, `POST .../preview`, `POST .../test-send`. Optimistic concurrency via `serverVersion` (409 on conflict).

### 3.3 One editor, many kinds

```ts
interface TemplateKindConfig {
  kind: TemplateKind; family: "email" | "document" | "sms";
  chrome: "emailShell" | "a4Page" | "none";
  dataContract: ZodType; sampleDataProvider: () => Promise<unknown[]>;
  allowedBlocks: BlockType[]; requiredBlocks?: BlockType[];   // invoice must contain lineItems + totals
  lockedRegions?: { top?: Block[]; bottom?: Block[] };        // legal footer, OTP code block
  channels: Channel[];
}
```

Email kinds mount the email shell (successor to `wrapEmailHtml`); document kinds mount A4 chrome; SMS kinds collapse to a text composer with segment counter. Palette/canvas/inspector/history/preview are 100% shared. Entry points stay in-domain: Notifications → email/SMS kinds; Finance → invoice docs; Quotes → quote doc; Reports → report/QA themes; Forms → form builder (stays its own specialized editor, shares palette/inspector/theme primitives + tokens).

## 4. Template-by-template replan

**Shared luxury language** (all channels): ivory canvas; white content card, hairline rules; serif display headings with a short gold rule accent; brand color reserved for actions/links; gold for eyebrows, rules, emphasis numerals; generous whitespace; single restrained CTA per email; documents get letterhead + branded footer with ABN/contact.

**Shell A — "Notice"** (short operational email): header(compact) → heading → text → infoCard → button → footer.
**Shell B — "Digest"** (scheduled summaries): header → hero(date eyebrow) → statRow → per-section infoCard/lineItems → button → footer.
**Shell C — "Document delivery"**: header → hero(greeting) → infoCard(document facts) → totals-teaser/key stat → button("View/Pay/Read") → terms-lite → footer.

### 4.1 App email templates (30 keys)

1. **signupOtp** — Shell A, locked layout; oversized gold serif OTP in a bordered infoCard; expiry caption; "didn't request this?" footer.
2. **resetPassword** — Shell A; temp password in code treatment; "Sign in" CTA; security callout.
3. **welcomeAccount** — Shell C warm hero; role chip; credentials infoCard; 3-step "what happens next"; portal CTA.
4. **accountInvite** — as welcome, reframed as invitation; inviter note as quoted callout.
5. **newProfileCreated** (admin) — Shell A; infoCard of profile facts; "Review profile" CTA.
6. **jobReminder24h** — Shell A; date-block motif (big serif day/date beside property); property/address/time infoCard; timing flags as amber chips; map link; "Open job" CTA.
7. **jobAssigned** — Shell A; "New assignment" gold eyebrow; job infoCard; accept/view CTA; calendar-add link. (Bulk variant = same doc with `lineItems` bound to the jobs array — one template, not custom code.)
8. **jobRemoved** — Shell A; neutral callout(info); struck-through job header treatment; "See your schedule" CTA.
9. **laundryReady** — Shell A; pickup/dropoff statRow; bagLocation callout; laundry photo grid; jobNumber meta.
10. **laundrySkipRequested** (admin) — Shell A; warning callout with reasonCode chip + note; Approve/Decline CTA row.
11. **laundrySkipApproved** — Shell A; success decision banner; reason; schedule-impact line.
12. **cleaningReportShared** — Shell C flagship: property hero (serif name, clean date eyebrow); job facts; "Read your report" CTA; teaser statRow (rooms done, photos captured); review-invite footer.
13. **reportVisibilityChanged** — Shell A; visibility state chip; note; report CTA.
14. **laundryReport** — Shell C; period hero; "PDF attached" callout; portal CTA.
15. **cleanerInvoice** — Shell C to the cleaner: period + jobCount statRow; PDF chip; earnings teaser in gold numerals; banking reminder.
16. **clientInvoiceIssued** — Shell C flagship: "Tax Invoice {{invoice.number}}" eyebrow; amount-due hero numeral; period + due date; "View & pay" CTA; payment-methods strip; terms-lite footer.
17. **lostFoundAlert** — Shell A; item card (name, location, photo); property/job meta; "Open case" CTA.
18. **extraPayRequest** (admin) — Shell A; amount in gold numeral; requestType chip; cleaner note quote; Approve/Review CTA.
19. **caseCreated** — Shell A; priority-tinted callout header (urgent = restrained crimson); case infoCard; CTA.
20. **caseUpdated** — Shell A; status chip pair (old → new); update quote; CTA.
21. **shoppingRunSubmitted** (admin) — Shell A; amount + payer statRow; property chips; receipt thumbnails; Review CTA.
22. **shoppingReimbursementToClient** — Shell C; amount numeral; per-property lineItems; "included in your next invoice" note.
23. **stockRunRequested** — Shell A; property + requestedBy; "Start stock count" CTA.
24. **stockRunSubmitted** — Shell A; lineCount stat; Review CTA.
25. **adminAttentionSummary** — Shell B flagship: date hero; statRow (attention/approvals/unassigned/cases); structured per-category `lineItems` replacing today's `breakdownHtml` blob; "Open approvals" CTA. *(Needs structured-array payloads — see §5.)*
26. **tomorrowJobsSummary** — Shell B; day hero; compact schedule lineItems (time, property, cleaner, type chip); timing chips; "Open calendar" CTA.
27. **tomorrowLaundrySummary** — Shell B; pickups/dropoffs split; per-task rows; route hint.
28. **criticalInventoryTomorrow** — Shell B; warning callout; per-property critical items lineItems; "Open inventory" CTA.
29. **quoteApprovalRequest** (admin) — Shell A; total numeral; client/serviceType infoCard; Approve/Open CTAs.
30. **quoteSentToClient** — Shell C flagship: "Your proposal, {{clientName}}" hero; serviceType + validUntil; total teaser with "from" framing; "View your quote" CTA; 3 what's-included highlights; validity countdown footer.

*(The 20 EMAIL_AUTO_KINDS gate sends — they don't render; untouched. The 50 finance `NotificationTemplate` events adopt Shell A/C via the DB-override path — invoice/payroll/payment/Xero families each get one family layout with per-event copy.)*

### 4.2 Documents

**Client invoice** (`doc.clientInvoice`): letterhead header (logo + identity + ABN left; "TAX INVOICE", number, dates right); bill-to/property twin infoCards; period gold eyebrow; lineItems grouped by property (hairline rules, repeated header per page); totals ledger (subtotal, GST `when: gstEnabled`, adjustments, **amount due** with gold rule + serif numeral); payment panel (bank details + payment-link QR in columns); terms + footer with page numbers. Snapshot at approve/send; Xero unchanged.

**Cleaner invoice / RCTI** (`doc.cleanerInvoice`): "RECIPIENT-CREATED TAX INVOICE" eyebrow; cleaner identity + ABN; period statRow (jobs, hours, gross, adjustments, net); lineItems grouped by day with reason chips; tinted pay-adjustments section (`when` non-empty); totals + super/GST notes; banking confirmation; dispute-window footer.

**Laundry invoice** (`doc.laundryInvoice`): letterhead with per-user overrides mapped into theme+text (the 3-field AppSetting retires into a USER-scoped `TemplateDefinition`); period meta; task lineItems; totals; hand-off notes callout; editable footerNote.

**Quote** (`doc.quote`) — most sales-critical: cover treatment (full-width brand band, serif "Proposal for {{client.name}}", property/serviceType eyebrow, validity chip); scope summary + highlights statRow; pricing lineItems with optional-extras subsection; totals with "from" framing; **checklistSection in marketing mode** — what's covered (✓) and explicitly-not-covered — the checklist library finally rendering on the sales artifact; acceptance signature + "Accept quote" URL/QR; terms.

**Client report** (`doc.clientReport`): branded cover (property serif title, clean date, jobType chip, cleaner first-name, hero photo); summary statRow (tasks %, photos, duration, issues); priority tasks as lineItems with outcome chips + evidence photoGrid; one `checklistSection` per schema section — **bound to `__templateSchema` exactly as now**; issues/damage callouts; before/after gallery; sign-off signature + next-clean footer. Report themes become named `ThemeOverride` presets per client.

**QA report** (`doc.qaReport`): "QA INSPECTION" eyebrow; job/property/cleaner/inspector meta; `qaScoreCard` (verdict + score ring + category bars); findings lineItems (expected vs observed, severity chip, note, evidence); rework section (`when: rework.required`); last-3-scores trend footnote + inspector signature.

**Laundry report** — clientReport shell with laundry data: period meta, per-property task tables with status timeline chips, exception callouts, evidence grid, totals strip.

**PDF checklist** (`doc.checklist`): brand cover band, serviceType title, summary; two-column checklistSection print mode (covered ✓, per-room, how-to suppressed); muted "not covered" panel; footer with quote/contact CTA and QR.

### 4.3 SMS

- **Job reminder / assignment / removal** — `"{{companyName}}: {{jobType}} at {{property.shortName}} {{when | date:\"EEE d MMM h:mma\"}}. Details: {{shortUrl}}"`; 1-segment budget enforced by editor lint.
- **Client job updates (en-route/started/completed)** — first-name greeting, one fact, one short link; ≤2 segments; opt-out auto-appended on marketing-category only.
- **Post-job review / follow-up** — `{{client_name}}`-era variables kept via alias map; segment counter + throttle notice in editor.
- **Finance events smsBody (50)** — terse: `"{{companyName}}: Invoice {{invoice.number}} {{status}}. {{amount | money}}. {{shortUrl}}"`; per-family defaults, per-event overrides.
- All SMS docs = single `textBlock` templates — same versioning, variable picker, publish lint (segments, unresolved vars, URL shortening).

## 5. Migration plan

### 5.1 Phasing (each phase shippable, old system keeps working)

1. **Foundations (invisible):** brand tokens module; block registry + model + 4 renderers; TemplateDefinition/Version/RenderedDocument migrations; formatters; data contracts for 3 pilot kinds.
2. **Editor MVP** on pilots — `clientInvoiceIssued` email, `doc.clientInvoice`, one SMS kind — proving all three families in one editor.
3. **Documents wave:** quote → client report → cleaner invoice → QA report → laundry docs → checklist PDF. Each behind a per-kind flag `templateEngineV2.kinds[kind]` in AppSettings with instant legacy fallback.
4. **Email wave:** seed all 30 app templates + 50 event defaults as SYSTEM definitions from §4; flip `renderEmailTemplate()` to the new resolver.
5. **Cleanup:** delete legacy string builders, retire `email-blocks.ts` designer, remove `{var}` dialect after a deprecation window.

### 5.2 Mapping existing stored artifacts → new model

| Legacy store | Migration |
|---|---|
| `AppSettings.emailTemplates` (admin-overridden per key) | Seed script: overridden keys → `TemplateDefinition` with subject + HTML imported as `richText`/`legacyHtml` block; untouched keys get the §4 luxury docs directly |
| `NotificationTemplate` rows (50 events) | Same importer; `emailBodyHtml` → blocks (parse the `SNEEK_EMAIL_DESIGN:` comment when present — lossless, the 6 EmailDesign blocks map 1:1); `smsBody` → sms doc; `availableVars` cross-checked against the contract |
| Raw legacy HTML, no design marker | Quarantined `legacyHtml` block (rendered verbatim, "rebuild recommended" flag) — nothing lost |
| Laundry per-user 3-field AppSetting | → USER-scoped TemplateDefinition theme/text overrides; read-through shim until migrated |
| Report `seed-themes` | → named `ThemeOverride` presets on `doc.clientReport` |
| `MessageTemplate` (client automation) | Body/subject → sms/email docs; **variable alias map** (`client_name → client.name`) so existing rules keep resolving; automation rules untouched |
| `{var}` single-brace | Resolver accepts both; importer rewrites to `{{var}}`; lint warns |
| `breakdownHtml`/`summaryHtml` pre-rendered variables | Interim `legacyHtml` slot so digests work day one; follow-up tickets change senders to pass structured arrays (the only sender-side changes) |

### 5.3 Compatibility shims (what must keep working — and how)

- **Email automation gating:** untouched by construction. The new resolver produces `{subject, html}` and still calls `sendEmailDetailed()` with the same kind/transactional semantics. `renderEmailTemplate(key, vars)` keeps its exact signature as a facade: published v2 doc → render; else legacy.
- **Report `__templateSchema` snapshots:** form engine, submit route, snapshot embedding **not modified**. `checklistSection` consumes the snapshot with the same precedence (`snapshot ?? template.schema`) and semantics (the generator's logic extracted into the block renderer, not rewritten). Old reports re-render identically; regenerated reports pick up new *styling* only; issued reports additionally freeze via `RenderedDocument`.
- **Invoice immutability + Xero:** invoice generation, lines, statuses, Xero push/CSV untouched — only `buildClientInvoiceHtml` gains a v2 path behind the flag. New guarantee added: PDF/HTML snapshot at approval.
- **Per-property generated form templates:** `composeFormSchema` → FormTemplate versioning → overrides pipeline is out of scope and continues verbatim; the form builder keeps its own editor. Shared pieces (brand tokens, theme editor, dnd-kit patterns, RHF inspector primitives) extracted *up* so both editors converge visually without coupling data models.
- **Send/audit logs:** additive nullable `templateVersionId` columns.
- **Rollback:** every kind independently reversible via the per-kind flag; legacy builders deleted only in phase 5 after a full billing cycle + one report cycle on v2.

### 5.4 Risk register (top items)

1. **Email-client fidelity** — table/inline renderer lineage kept; email-safety publish lint; test-sends; Outlook/Gmail screenshot QA on the email wave.
2. **PDF pagination** of long lineItems/photo grids — print CSS (`break-inside: avoid`, repeated `thead`) validated in the phase-2 pilot before the report wave.
3. **Digest emails with pre-rendered `*Html` payloads** — quarantined as `legacyHtml`; the only senders needing code changes.
4. **dnd-kit maintenance slowdown** — accepted and pinned; DnD surface is thin (sortable lists), portable to Pragmatic later without touching the document model.
5. **Editor scope creep** — capped by the kind-config contract: new template = data contract + sample provider + allowed blocks; no per-kind editor code.
