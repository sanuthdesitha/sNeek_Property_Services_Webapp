export interface SeedMessageTemplate {
  name: string;
  category: string;
  channel: "EMAIL" | "SMS" | "BOTH";
  subject?: string;
  body: string;
  variables?: string[];
}

export const SEED_MESSAGE_TEMPLATES: SeedMessageTemplate[] = [
  // CHASE
  {
    name: "New client intro",
    category: "CHASE",
    channel: "EMAIL",
    subject: "Welcome to sNeek Property Services",
    body: "Hi {{client.firstName}},\n\nThanks for reaching out. We help property owners across {{client.suburb}} keep their places guest-ready.\n\nWhen would suit you for a quick chat?\n\n— sNeek team",
    variables: ["client.firstName", "client.suburb"],
  },
  {
    name: "Quote follow-up — 1 day",
    category: "CHASE",
    channel: "EMAIL",
    subject: "Following up on your quote",
    body: "Hi {{client.firstName}},\n\nJust checking in on the quote we sent yesterday for {{property.name}}. Any questions?\n\n— sNeek team",
    variables: ["client.firstName", "property.name"],
  },
  {
    name: "Quote follow-up — SMS 3 days",
    category: "CHASE",
    channel: "SMS",
    body: "Hey {{client.firstName}}! Quick check — still interested in the clean we quoted at {{quote.totalAmount | currency}}? Reply YES and we'll lock it in.",
    variables: ["client.firstName", "quote.totalAmount"],
  },
  {
    name: "Long-silence follow-up — 14 days",
    category: "CHASE",
    channel: "EMAIL",
    subject: "Last chance to lock in your cleaner",
    body: "Hi {{client.firstName}},\n\nHaven't heard back so I'll close out the file. If timing's still not right, just hit reply when it is.\n\n— sNeek team",
    variables: ["client.firstName"],
  },

  // MARKETING
  {
    name: "Seasonal promo — Spring clean",
    category: "MARKETING",
    channel: "EMAIL",
    subject: "20% off your first spring clean",
    body: "Hi {{client.firstName}},\n\nSpring's here — book a deep clean before {{job.scheduledFor | date short}} and we'll take 20% off.\n\nBook online or reply to this email.\n\n— sNeek",
    variables: ["client.firstName", "job.scheduledFor"],
  },
  {
    name: "Referral request",
    category: "MARKETING",
    channel: "EMAIL",
    subject: "Know anyone who needs a cleaner?",
    body: "Hi {{client.firstName}},\n\nIf you've enjoyed working with us, would you be open to a referral? $50 credit for you, $50 off for them.\n\n— sNeek team",
    variables: ["client.firstName"],
  },
  {
    name: "Loyalty milestone — 10 cleans",
    category: "MARKETING",
    channel: "EMAIL",
    subject: "Thanks for your 10th clean!",
    body: "Hi {{client.firstName}},\n\nWe've just wrapped your 10th clean with us. As a thanks, your next clean is on us.\n\n— sNeek",
    variables: ["client.firstName"],
  },

  // OPERATIONAL
  {
    name: "Booking confirmation",
    category: "OPERATIONAL",
    channel: "EMAIL",
    subject: "Your clean is booked",
    body: "Hi {{client.firstName}},\n\nYou're booked: {{job.scheduledFor | date short}} at {{job.scheduledFor | time}} for {{property.name}}.\n\nReply to this email if anything changes.\n\n— sNeek",
    variables: ["client.firstName", "job.scheduledFor", "property.name"],
  },
  {
    name: "En-route notice",
    category: "OPERATIONAL",
    channel: "SMS",
    body: "Your cleaner is on the way to {{property.name}} — ETA about 20 min.",
    variables: ["property.name"],
  },
  {
    name: "Job complete",
    category: "OPERATIONAL",
    channel: "EMAIL",
    subject: "Your clean is complete",
    body: "Hi {{client.firstName}},\n\nWe're done at {{property.name}}. Photos and report attached.\n\nThanks for trusting us.\n\n— sNeek",
    variables: ["client.firstName", "property.name"],
  },

  // SERVICE_RECOVERY
  {
    name: "Apology + makegood",
    category: "SERVICE_RECOVERY",
    channel: "EMAIL",
    subject: "We're sorry about your last clean",
    body: "Hi {{client.firstName}},\n\nThat one didn't meet our standard. We're sending someone back tomorrow morning to put it right, on us.\n\nIs that OK?\n\n— sNeek",
    variables: ["client.firstName"],
  },
  {
    name: "Complaint acknowledgment",
    category: "SERVICE_RECOVERY",
    channel: "EMAIL",
    subject: "Got your message — looking into it",
    body: "Hi {{client.firstName}},\n\nThanks for letting us know. I'm reviewing what happened on {{job.scheduledFor | date short}} and will be back to you by tomorrow.\n\n— sNeek",
    variables: ["client.firstName", "job.scheduledFor"],
  },

  // FEEDBACK
  {
    name: "Post-job rating request",
    category: "FEEDBACK",
    channel: "EMAIL",
    subject: "How did we do?",
    body: "Hi {{client.firstName}},\n\nHow was the clean? Two questions, takes 20 seconds.\n\n[Link to feedback form]\n\n— sNeek",
    variables: ["client.firstName"],
  },
  {
    name: "NPS survey",
    category: "FEEDBACK",
    channel: "EMAIL",
    subject: "Quick 1-question survey",
    body: "Hi {{client.firstName}},\n\nOn a scale of 0–10, how likely are you to recommend us?\n\n— sNeek",
    variables: ["client.firstName"],
  },
  {
    name: "Google review prompt",
    category: "FEEDBACK",
    channel: "SMS",
    body: "Glad you're happy with the clean! Could you leave us a quick Google review? [link]",
    variables: [],
  },

  // ONBOARDING
  {
    name: "Welcome — first job booked",
    category: "ONBOARDING",
    channel: "EMAIL",
    subject: "Welcome to sNeek — first clean is booked",
    body: "Hi {{client.firstName}},\n\nWelcome aboard. Your first clean is on {{job.scheduledFor | date short}}.\n\nA few things to know: [link to onboarding guide].\n\n— sNeek",
    variables: ["client.firstName", "job.scheduledFor"],
  },

  // CLEANER_FACING
  {
    name: "Shift offer",
    category: "CLEANER_FACING",
    channel: "SMS",
    body: "Hey {{cleaner.firstName}}, shift available at {{property.name}} on {{job.scheduledFor | date short}} at {{job.scheduledFor | time}}. Reply YES to claim.",
    variables: ["cleaner.firstName", "property.name", "job.scheduledFor"],
  },
  {
    name: "Schedule change",
    category: "CLEANER_FACING",
    channel: "SMS",
    body: "Heads up {{cleaner.firstName}} — your {{property.name}} job moved to {{job.scheduledFor | date short}} at {{job.scheduledFor | time}}.",
    variables: ["cleaner.firstName", "property.name", "job.scheduledFor"],
  },
  {
    name: "Recognition",
    category: "CLEANER_FACING",
    channel: "EMAIL",
    subject: "Great work today",
    body: "Hi {{cleaner.firstName}},\n\nClient feedback was glowing. Thanks for the great work today.\n\n— sNeek team",
    variables: ["cleaner.firstName"],
  },
];
