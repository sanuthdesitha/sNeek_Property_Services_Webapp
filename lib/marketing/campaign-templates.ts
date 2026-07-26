/**
 * Ready-to-send marketing campaign templates for sNeek Property Services
 * (Sydney, NSW). These are FINISHED copy — an admin can pick one, swap a date
 * or a price, and send. No lorem, no placeholders beyond the live `{{client.*}}`
 * variable tokens listed in TEMPLATE_VARIABLE_TOKENS.
 *
 * Constraints deliberately baked in:
 *  - Australian English (organise, colour, "bond clean", "EOFY", "public holiday").
 *  - All prices are GST inclusive and say so — required for consumer pricing in AU.
 *  - Blocks use the EXACT shapes from lib/templates/email-blocks.ts so the whole
 *    gallery renders through renderEmailHtml() with no adapter layer.
 *  - Variables are limited to tokens lib/messages/variables.ts can actually
 *    resolve for a broadcast campaign, where the only context is `{ client }`.
 *    (job/property/quote/cleaner roots exist in the resolver but a broadcast has
 *    no single job or property, so they would render as an empty string.)
 */
import type { EmailBlock, EmailDesign } from "@/lib/templates/email-blocks";
import type { SegmentId } from "@/lib/marketing/segments";

export type TemplateCategory =
  | "seasonal"
  | "lifecycle"
  | "promotion"
  | "announcement"
  | "trust"
  | "newsletter";

export type TemplateChannel = "EMAIL" | "SMS" | "BOTH";

export type CampaignTemplate = {
  id: string;
  name: string;
  category: TemplateCategory;
  channel: TemplateChannel;
  subject: string;
  previewText: string;
  blocks: EmailBlock[];
  smsBody?: string;
  suggestedAudience: SegmentId;
  /** Variable tokens used anywhere in subject / blocks / smsBody. */
  variables: string[];
  goal: string;
};

/**
 * The ONLY variable tokens these templates may use. Each maps to a real path
 * that lib/messages/variables.ts resolves from the `client` root:
 *   client.firstName / client.lastName are synthesised from Client.name,
 *   the rest are columns on the Client model.
 */
export const TEMPLATE_VARIABLE_TOKENS = [
  "client.firstName",
  "client.lastName",
  "client.name",
  "client.suburb",
] as const;

export const TEMPLATE_CATEGORY_META: Record<TemplateCategory, { label: string; description: string }> = {
  seasonal: { label: "Seasonal", description: "Time-of-year pushes — spring, EOFY, Christmas." },
  lifecycle: { label: "Lifecycle", description: "Triggered by where a client sits in their journey." },
  promotion: { label: "Promotion", description: "Offers, discounts, and referral incentives." },
  announcement: { label: "Announcement", description: "New services, price changes, operational notices." },
  trust: { label: "Trust", description: "Relationship builders — people, process, reassurance." },
  newsletter: { label: "Newsletter", description: "Recurring general-update shells." },
};

const INK = "#10322a";
const BODY = "#33433d";
const MUTED = "#6b7a74";
const BRAND = "#0f5a44";
const LINE = "#e2e8e4";

function heading(id: string, text: string, fontSize = 22): EmailBlock {
  return { id, type: "heading", text, align: "left", color: INK, fontSize };
}
function text(id: string, body: string, color = BODY, fontSize = 15): EmailBlock {
  return { id, type: "text", text: body, align: "left", color, fontSize };
}
function button(id: string, label: string, href: string): EmailBlock {
  return { id, type: "button", text: label, href, align: "left", bg: BRAND, color: "#ffffff", radius: 8 };
}
function divider(id: string): EmailBlock {
  return { id, type: "divider", color: LINE };
}
function spacer(id: string, height = 16): EmailBlock {
  return { id, type: "spacer", height };
}

/** Shared sign-off so every template reads like the same business wrote it. */
function signOff(prefix: string): EmailBlock[] {
  return [
    spacer(`${prefix}-sp`, 12),
    divider(`${prefix}-dv`),
    text(
      `${prefix}-sig`,
      "Sanuth & the sNeek Property Services team\nSydney, NSW · 7 days a week\nsNeek Property Services — Airbnb turnovers, end-of-lease cleans, regular home cleaning and laundry.",
      MUTED,
      13,
    ),
  ];
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  // ─────────────────────────────────────────────────────────── seasonal ──
  {
    id: "spring-clean-promo",
    name: "Spring clean promo",
    category: "seasonal",
    channel: "BOTH",
    subject: "Book your spring clean before the September rush, {{client.firstName}}",
    previewText: "Windows, skirtings, tracks, fans — the once-a-year reset. Spring spots book out fast in Sydney.",
    suggestedAudience: "all_active_clients",
    variables: ["client.firstName", "client.suburb"],
    goal: "Fill the September–October calendar with high-value spring/deep cleans before peak demand.",
    blocks: [
      heading("spring-h1", "Spring is when the house shows everything"),
      text(
        "spring-t1",
        "Hi {{client.firstName}},\n\nThe light changes in September and suddenly you can see every window track, skirting board and ceiling fan you have been politely ignoring since autumn. That is what a spring clean is for.",
      ),
      text(
        "spring-t2",
        "Our spring clean goes well past a regular tidy:\n• Windows inside and out (ground level), plus tracks and sills\n• Skirting boards, door frames, light switches and power points\n• Ceiling fans, air-con filters and vents\n• Inside the oven, rangehood filter and inside the fridge\n• Wardrobe tops, behind and under furniture we can safely move",
      ),
      text(
        "spring-t3",
        "Spring cleans are quoted on the size and condition of the home rather than a flat rate, so you only pay for the work the place actually needs. Every price we quote is GST inclusive with no call-out fee.",
      ),
      spacer("spring-sp1", 8),
      button("spring-b1", "Get a spring clean quote", "/quote"),
      spacer("spring-sp2", 8),
      text(
        "spring-t4",
        "September and October are our two busiest months across the Sydney metro, and {{client.suburb}} fills early. If you would like a weekend slot, it is worth locking it in now.",
        MUTED,
        14,
      ),
      ...signOff("spring"),
    ],
    smsBody:
      "Hi {{client.firstName}}, sNeek here. Spring clean spots for Sept/Oct are opening now — windows, tracks, fans, oven, the lot. Prices are GST inclusive, no call-out fee. Grab a quote: https://sneekproservices.com.au/quote — reply STOP to opt out.",
  },
  {
    id: "eofy-tax-time",
    name: "EOFY / tax-time (investors & hosts)",
    category: "seasonal",
    channel: "EMAIL",
    subject: "EOFY: your cleaning invoices, sorted before 30 June",
    previewText: "A tidy summary of every clean we have done for you this financial year — and a nudge to book what is left.",
    suggestedAudience: "airbnb_property_clients",
    variables: ["client.firstName"],
    goal: "Reinforce the record-keeping value of the portal to investors and hosts, and pull forward pre-30-June spend.",
    blocks: [
      heading("eofy-h1", "End of financial year — let's make your paperwork boring"),
      text(
        "eofy-t1",
        "Hi {{client.firstName}},\n\n30 June is close, and if you hold an investment or short-stay property, cleaning is one of the deductions that most often ends up as a shoebox of half-remembered bank transactions.",
      ),
      text(
        "eofy-t2",
        "It does not have to be. Every job we complete for you is invoiced with the date, the property, the service and the GST shown separately, and the full history sits in your client portal. Log in, filter by date range, and you have a clean list to hand your accountant.",
      ),
      spacer("eofy-sp1", 8),
      button("eofy-b1", "Open my invoice history", "/portal/invoices"),
      spacer("eofy-sp2", 8),
      text(
        "eofy-t3",
        "Two things worth doing before 30 June:\n1. Bring forward any deep clean, carpet steam clean or pressure wash you were planning for July — it lands in this financial year instead.\n2. Tell us if the invoices need to go to a different email, your accountant or your property manager. We will update it in a minute.",
      ),
      text(
        "eofy-t4",
        "We are not accountants and this is general information, not tax advice — please check your own situation with your registered tax agent.",
        MUTED,
        13,
      ),
      ...signOff("eofy"),
    ],
  },
  {
    id: "christmas-holiday-hours",
    name: "Christmas availability & hours",
    category: "seasonal",
    channel: "BOTH",
    subject: "Our Christmas + New Year cleaning schedule (and how to lock in a spot)",
    previewText: "We work through most of the break. Here are the dates, the public holiday surcharges, and when to book.",
    suggestedAudience: "all_active_clients",
    variables: ["client.firstName"],
    goal: "Set holiday expectations clearly, avoid last-minute chaos, and capture pre-Christmas guest-ready bookings.",
    blocks: [
      heading("xmas-h1", "Christmas and New Year — here is how we are running"),
      text(
        "xmas-t1",
        "Hi {{client.firstName}},\n\nSydney does not stop over the break and neither do short-stay guests, so we keep a reduced crew running right through. Here is exactly what is available.",
      ),
      text(
        "xmas-t2",
        "Operating dates\n• Up to and including 24 December — normal service, all job types\n• 25 December and 26 December — Airbnb turnovers only, by prior arrangement\n• 27–31 December — normal service, reduced crew\n• 1 January — Airbnb turnovers only, by prior arrangement\n• From 2 January — back to full capacity",
      ),
      text(
        "xmas-t3",
        "Public holiday work (25 and 26 December, 1 January) carries a public holiday loading, which we will always quote to you in writing before the job — GST inclusive, no surprises on the invoice.",
      ),
      text(
        "xmas-t4",
        "If you are hosting family, the pre-Christmas week books out first. Regular clients get first call on those slots, but only if we hear from you.",
      ),
      spacer("xmas-sp1", 8),
      button("xmas-b1", "Book a holiday-period clean", "/quote"),
      ...signOff("xmas"),
    ],
    smsBody:
      "Hi {{client.firstName}} — sNeek holiday schedule: normal service to 24 Dec, Airbnb turnovers only 25/26 Dec & 1 Jan (public holiday loading applies, quoted upfront), full capacity from 2 Jan. Pre-Christmas slots fill fast — reply to book. Reply STOP to opt out.",
  },

  // ────────────────────────────────────────────────────────── lifecycle ──
  {
    id: "airbnb-host-welcome",
    name: "Airbnb host onboarding welcome",
    category: "lifecycle",
    channel: "EMAIL",
    subject: "Welcome aboard, {{client.firstName}} — here's how your turnovers will run",
    previewText: "Calendar sync, linen, photo proof and what happens when a guest leaves a mess. Everything in one place.",
    suggestedAudience: "airbnb_property_clients",
    variables: ["client.firstName"],
    goal: "Onboard a new short-stay host properly so the first month has no surprises and no churn.",
    blocks: [
      heading("host-h1", "Welcome to sNeek, {{client.firstName}}"),
      text(
        "host-t1",
        "Thanks for trusting us with your short-stay property. Turnovers are unforgiving — the guest checks out at 10am and the next one arrives at 2pm — so here is exactly how we work, in writing, before your first clean.",
      ),
      divider("host-d1"),
      text(
        "host-t2",
        "1. Your calendar drives the schedule\nSend us your Airbnb or Hospitable iCal link and we sync it. New booking appears, turnover is created automatically. No group chat, no forgetting.",
      ),
      text(
        "host-t3",
        "2. Linen is handled\nWe run a laundry service, so sheets and towels go out and come back on a rotation with buffer sets kept at the property. You stop counting pillowcases.",
      ),
      text(
        "host-t4",
        "3. You get photo proof, every time\nEvery turnover finishes with photos of the made beds, the bathrooms, the kitchen and the reset. They land in your portal, timestamped. If a guest claims the place was not clean, you have the evidence.",
      ),
      text(
        "host-t5",
        "4. Damage and mess get flagged immediately\nIf a guest leaves damage, stains or missing items, you get photos and a message during the clean — while you can still open an AirCover claim.",
      ),
      text(
        "host-t6",
        "5. Restocking\nTell us your consumables list once (toilet paper, bin liners, coffee pods, soap) and we track and top up, with the cost itemised on your invoice.",
      ),
      divider("host-d2"),
      text(
        "host-t7",
        "Turnover pricing is per-clean and GST inclusive, based on your bedroom and bathroom count plus linen volume. Same price whether the guest was tidy or not — that risk is ours, not yours.",
      ),
      spacer("host-sp1", 8),
      button("host-b1", "Open my host portal", "/portal"),
      text(
        "host-t8",
        "Anything unclear, reply to this email. A real person on the Sydney team reads it.",
        MUTED,
        14,
      ),
      ...signOff("host"),
    ],
  },
  {
    id: "post-clean-review-request",
    name: "Post-clean review request",
    category: "lifecycle",
    channel: "BOTH",
    subject: "How did we go, {{client.firstName}}?",
    previewText: "Thirty seconds of your time, and it genuinely decides who finds us next.",
    suggestedAudience: "clients_with_job_last_90d",
    variables: ["client.firstName"],
    goal: "Convert recent happy cleans into public Google reviews, and catch unhappy ones privately before they go public.",
    blocks: [
      heading("rev-h1", "How did we go?"),
      text(
        "rev-t1",
        "Hi {{client.firstName}},\n\nWe cleaned for you recently and we would love to know how it landed. Honestly — the good and the not-so-good.",
      ),
      text(
        "rev-t2",
        "If we got it right, a Google review is the single most useful thing you can do for us. We are a small Sydney team, we do not buy ads, and almost every new client finds us because someone like you wrote two sentences.",
      ),
      spacer("rev-sp1", 8),
      button("rev-b1", "Leave a Google review", "/reviews"),
      spacer("rev-sp2", 8),
      text(
        "rev-t3",
        "If we did NOT get it right, please reply to this email instead. We would rather fix it than read about it later. We will come back and re-clean the area at no charge — that is the deal, and we mean it.",
      ),
      ...signOff("rev"),
    ],
    smsBody:
      "Hi {{client.firstName}}, thanks for having sNeek in recently. If we did a good job, a quick Google review helps our small Sydney team more than anything: https://sneekproservices.com.au/reviews — and if anything was off, reply here and we'll come back and fix it free. Reply STOP to opt out.",
  },
  {
    id: "win-back-dormant",
    name: "Win-back — no booking in 60+ days",
    category: "lifecycle",
    channel: "EMAIL",
    subject: "It's been a while, {{client.firstName}} — is everything alright?",
    previewText: "No hard sell. Just checking whether we dropped the ball or life just got busy.",
    suggestedAudience: "dormant_90d",
    variables: ["client.firstName", "client.suburb"],
    goal: "Reactivate lapsed clients and, just as importantly, find out why they stopped.",
    blocks: [
      heading("win-h1", "We have not seen you in a while"),
      text(
        "win-t1",
        "Hi {{client.firstName}},\n\nIt has been a couple of months since your last clean with us and we noticed. This is not an automated guilt trip with a 10% off code stapled to it — we would genuinely like to know which of these it is:",
      ),
      text(
        "win-t2",
        "• Life got busy and it just slipped. Completely normal. Reply with a rough week and we will find you a slot.\n• Something about the last clean was not right. Please tell us. We would rather hear it late than never.\n• You have moved, sold, or changed arrangements. Let us know and we will stop emailing you about it.",
      ),
      text(
        "win-t3",
        "If you would like to start again, we can set you up on a fortnightly or monthly regular clean with the same cleaner each visit, so you are not re-explaining your house every time. Regular clients get priority on weekend slots and a lower hourly rate than one-off work — all quoted GST inclusive.",
      ),
      spacer("win-sp1", 8),
      button("win-b1", "Get a fresh quote", "/quote"),
      spacer("win-sp2", 8),
      text(
        "win-t4",
        "We are still covering {{client.suburb}} and the surrounding suburbs seven days a week.",
        MUTED,
        14,
      ),
      ...signOff("win"),
    ],
  },

  // ────────────────────────────────────────────────────────── promotion ──
  {
    id: "referral-offer",
    name: "Referral offer",
    category: "promotion",
    channel: "BOTH",
    subject: "Know someone who needs a cleaner? There's $50 in it for both of you",
    previewText: "You get $50 off your next clean, they get $50 off their first. No codes to remember.",
    suggestedAudience: "clients_with_active_recurring",
    variables: ["client.firstName"],
    goal: "Drive word-of-mouth acquisition from the most loyal segment at a known, capped cost.",
    blocks: [
      heading("ref-h1", "Send us a neighbour, we will send you $50"),
      text(
        "ref-t1",
        "Hi {{client.firstName}},\n\nMost of our work comes from people telling other people. So we have made it worth your while.",
      ),
      text(
        "ref-t2",
        "Refer someone and when they book and complete their first clean:\n• They get $50 off that first clean\n• You get $50 off your next one\n\nBoth amounts are GST inclusive and come straight off the invoice — no vouchers, no expiry games, no minimum spend.",
      ),
      text(
        "ref-t3",
        "How it works: just have them mention your name when they request a quote, or reply to this email with their name and we will reach out. No referral code to remember, no app to download.",
      ),
      spacer("ref-sp1", 8),
      button("ref-b1", "Send them our quote page", "/quote"),
      spacer("ref-sp2", 8),
      text(
        "ref-t4",
        "There is no cap. Refer five people and that is five cleans essentially covered.",
        MUTED,
        14,
      ),
      ...signOff("ref"),
    ],
    smsBody:
      "Hi {{client.firstName}} — sNeek referral: send us someone who needs a cleaner and you BOTH get $50 off (GST incl, straight off the invoice) once their first clean is done. Just have them mention your name at https://sneekproservices.com.au/quote. Reply STOP to opt out.",
  },
  {
    id: "bond-clean-promo",
    name: "Bond / end-of-lease promo",
    category: "promotion",
    channel: "EMAIL",
    subject: "Moving out? Get the bond back without the argument",
    previewText: "A real end-of-lease clean with a re-clean guarantee if the agent picks something up.",
    suggestedAudience: "all_active_clients",
    variables: ["client.firstName"],
    goal: "Win high-value bond cleans, which are one-off, well-priced and highly referable.",
    blocks: [
      heading("bond-h1", "Bond cleans: done properly, guaranteed properly"),
      text(
        "bond-t1",
        "Hi {{client.firstName}},\n\nIf you or someone you know is moving out of a Sydney rental, the exit condition report is where bonds quietly disappear. Agents in this market check oven racks, window tracks, shower grout, range hood filters and the inside of every cupboard.",
      ),
      text(
        "bond-t2",
        "Our end-of-lease clean covers all of it:\n• Oven, grill, racks and rangehood filter degreased\n• Every window, track and sill, plus flyscreens\n• Shower screens, grout, tiles and tapware descaled\n• Inside and on top of all cupboards, drawers and wardrobes\n• Skirtings, door frames, switches, vents and light fittings\n• Walls spot-cleaned for marks\n• Carpet steam cleaning available as an add-on (most leases require it)",
      ),
      text(
        "bond-t3",
        "Our guarantee: if the agent or landlord flags a cleaning item on the exit report within 7 days, we come back and re-clean that item free. Send us the report, we book the return visit.",
      ),
      text(
        "bond-t4",
        "Bond cleans are quoted on bedrooms, bathrooms and condition — not a vague hourly promise — and the quote you accept is the GST inclusive price you pay.",
      ),
      spacer("bond-sp1", 8),
      button("bond-b1", "Get a bond clean quote", "/quote"),
      text(
        "bond-t5",
        "Tip: book for the day AFTER the furniture leaves and BEFORE the final inspection. Two or three days of buffer is ideal.",
        MUTED,
        14,
      ),
      ...signOff("bond"),
    ],
  },

  // ─────────────────────────────────────────────────────── announcement ──
  {
    id: "laundry-service-launch",
    name: "New service — laundry & linen",
    category: "announcement",
    channel: "EMAIL",
    subject: "New from sNeek: we now do your linen too",
    previewText: "Pickup, wash, press, return. Built for hosts, useful for everyone.",
    suggestedAudience: "all_active_clients",
    variables: ["client.firstName"],
    goal: "Cross-sell the laundry line into the existing cleaning base and lift revenue per client.",
    blocks: [
      heading("laun-h1", "We now run a laundry and linen service"),
      text(
        "laun-t1",
        "Hi {{client.firstName}},\n\nThe most common thing our short-stay hosts asked for was someone to take the sheets away. So we built it — and it turns out plenty of households want it too.",
      ),
      text(
        "laun-t2",
        "How it works\n• We collect your linen at the clean, or on a scheduled pickup run\n• Everything is washed, dried and pressed off site\n• It comes back on your next visit, folded and ready\n• We keep buffer sets at short-stay properties so a bed is never waiting on a wash",
      ),
      text(
        "laun-t3",
        "For hosts, this is the piece that makes same-day turnovers actually work: the outgoing set leaves with us and a fresh set is already on site. No 10am laundromat runs.",
      ),
      text(
        "laun-t4",
        "For households, it is sheets, towels, doona covers and the ironing pile you have been avoiding. Priced per bag or per set, GST inclusive, added to your existing invoice.",
      ),
      spacer("laun-sp1", 8),
      button("laun-b1", "Add laundry to my service", "/quote"),
      ...signOff("laun"),
    ],
  },
  {
    id: "price-update-notice",
    name: "Price update notice",
    category: "announcement",
    channel: "EMAIL",
    subject: "A small change to our rates from 1 [Month]",
    previewText: "What is changing, by how much, why, and what is not changing.",
    suggestedAudience: "all_active_clients",
    variables: ["client.firstName"],
    goal: "Communicate a rate rise with enough notice and honesty that almost nobody churns.",
    blocks: [
      heading("price-h1", "A small change to our rates"),
      text(
        "price-t1",
        "Hi {{client.firstName}},\n\nWe would rather tell you this directly than have you find it on an invoice, so: from 1 [Month] our standard rates increase by about [X]%.",
      ),
      text(
        "price-t2",
        "What that looks like in practice\n• Regular home cleaning: from $[old] to $[new] per hour, GST inclusive\n• Airbnb turnovers: from $[old] to $[new] per turnover for a [N]-bedroom property, GST inclusive\n• End-of-lease and specialty work: still quoted per job, roughly [X]% higher",
      ),
      text(
        "price-t3",
        "Why\nInsurance, fuel, cleaning consumables and wages have all moved, and we would rather adjust modestly than quietly cut time on site. We have not changed our rates since [previous date].",
      ),
      text(
        "price-t4",
        "What is not changing\n• Your cleaner. Same person, same day, same time.\n• No call-out fees, no travel charges, no weekend surcharge for regular clients.\n• Any quote already accepted is honoured at the old price.\n• Our re-clean guarantee.",
      ),
      text(
        "price-t5",
        "If this makes things tight, reply and talk to us. We can often adjust the scope or the frequency to keep your total spend where it was.",
      ),
      spacer("price-sp1", 8),
      button("price-b1", "View my current schedule", "/portal"),
      text(
        "price-t6",
        "Before sending: replace every [bracketed] value with the real figures and delete this line.",
        MUTED,
        13,
      ),
      ...signOff("price"),
    ],
  },

  // ────────────────────────────────────────────────────────────── trust ──
  {
    id: "meet-your-cleaner",
    name: "Meet your cleaner (trust builder)",
    category: "trust",
    channel: "EMAIL",
    subject: "The people who actually come to your home",
    previewText: "Who we hire, how they are checked, and why you get the same person each visit.",
    suggestedAudience: "all_active_clients",
    variables: ["client.firstName"],
    goal: "Reduce the trust barrier that keeps people on ad-hoc cleaners, and support the premium price point.",
    blocks: [
      heading("meet-h1", "Who is actually coming to your home"),
      text(
        "meet-t1",
        "Hi {{client.firstName}},\n\nLetting someone into your home while you are at work is a big deal, and we do not think it should be a mystery. So here is how our team works.",
      ),
      divider("meet-d1"),
      text(
        "meet-t2",
        "The same cleaner, every time\nWhere the roster allows, you keep the same person. They learn your home — which tap leaks, which floor cannot take water, where the vacuum lives — and the clean gets better every visit. If they are unwell or on leave, we tell you who is coming instead before the day.",
      ),
      text(
        "meet-t3",
        "Checked before they start\nEvery cleaner has a verified identity and right-to-work check, a Police Check on file, and full public liability insurance through us. Anyone working around children or vulnerable people also holds a current Working With Children Check.",
      ),
      text(
        "meet-t4",
        "Trained on your property, not just in general\nBefore a first clean we build a property profile — access, alarm, pets, no-go areas, your preferred products, the things that matter to you. New cleaners work to that profile with photo checkpoints, so nothing depends on someone remembering a conversation.",
      ),
      text(
        "meet-t5",
        "Paid properly\nOur cleaners are paid above award rates, per job, with travel accounted for. That is not a virtue signal — it is why they stay, and why you keep the same person.",
      ),
      divider("meet-d2"),
      text(
        "meet-t6",
        "If you ever want a different cleaner, for any reason at all, just tell us. You never have to explain why.",
      ),
      spacer("meet-sp1", 8),
      button("meet-b1", "See my property profile", "/portal"),
      ...signOff("meet"),
    ],
  },

  // ───────────────────────────────────────────────────────── newsletter ──
  {
    id: "monthly-newsletter",
    name: "Monthly newsletter shell",
    category: "newsletter",
    channel: "EMAIL",
    subject: "sNeek monthly — [Month] around Sydney",
    previewText: "What we have been up to, one useful cleaning tip, and what is coming next month.",
    suggestedAudience: "all_active_clients",
    variables: ["client.firstName"],
    goal: "Stay front of mind between bookings with something genuinely worth opening.",
    blocks: [
      heading("news-h1", "sNeek monthly — [Month]"),
      text(
        "news-t1",
        "Hi {{client.firstName}},\n\nA short one from the Sydney team. Three things, then we will leave you alone for a month.",
      ),
      divider("news-d1"),
      heading("news-h2", "1. What we have been up to", 17),
      text(
        "news-t2",
        "[One short paragraph — a new suburb you now cover, a new team member, a milestone, a piece of kit you bought. Keep it human and specific. Two or three sentences is plenty.]",
      ),
      divider("news-d2"),
      heading("news-h3", "2. This month's tip", 17),
      text(
        "news-t3",
        "[One genuinely useful, do-it-yourself cleaning tip. Examples worth rotating: how to stop shower grout going black in a humid Sydney summer; getting red wine out of wool carpet in the first ten minutes; why vinegar ruins natural stone benchtops; cleaning a rangehood filter in the dishwasher.]",
      ),
      divider("news-d3"),
      heading("news-h4", "3. Coming up", 17),
      text(
        "news-t4",
        "[What is on next month — a seasonal service, changed hours over a long weekend, a promotion, an availability warning. One or two lines.]",
      ),
      spacer("news-sp1", 8),
      button("news-b1", "Book or adjust a clean", "/portal"),
      spacer("news-sp2", 8),
      text(
        "news-t5",
        "Before sending: replace every [bracketed] section with real content and delete this line.",
        MUTED,
        13,
      ),
      ...signOff("news"),
    ],
  },
];

/** Page background / card background used when a template is rendered. */
export const TEMPLATE_DESIGN_CHROME = {
  pageBackground: "#f4f5f7",
  cardBackground: "#ffffff",
} as const;

/** Convert a template into the EmailDesign shape the block renderer consumes. */
export function templateToDesign(template: CampaignTemplate): EmailDesign {
  return {
    ...TEMPLATE_DESIGN_CHROME,
    blocks: template.blocks.map((block) => ({ ...block })),
  };
}

export function getCampaignTemplate(id: string): CampaignTemplate | null {
  return CAMPAIGN_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function getTemplatesByCategory(category: TemplateCategory): CampaignTemplate[] {
  return CAMPAIGN_TEMPLATES.filter((template) => template.category === category);
}

/** Every `{{token}}` used across subject, previewText, blocks and smsBody. */
export function extractTemplateTokens(template: CampaignTemplate): string[] {
  const haystack: string[] = [template.subject, template.previewText, template.smsBody ?? ""];
  for (const block of template.blocks) {
    if ("text" in block) haystack.push(block.text);
    if ("href" in block && block.href) haystack.push(block.href);
    if ("alt" in block && block.alt) haystack.push(block.alt);
  }
  const found = new Set<string>();
  for (const chunk of haystack) {
    for (const match of Array.from(chunk.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g))) {
      found.add(match[1].split("|")[0].trim());
    }
  }
  return Array.from(found);
}
