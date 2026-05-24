import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for Airbnb / short-stay turnovers.
 * Mirrors the cleaner Airbnb Turnover form sections — bedrooms, bathrooms,
 * kitchen, living, final + guest-readiness check.
 */
export const qaAirbnbTurnoverTemplate = buildQaTemplate({
  name: "Airbnb Turnover — QA Inspection v1",
  serviceType: "AIRBNB_TURNOVER",
  sections: [
    qaSection(
      "bedrooms",
      "Bedrooms — QA Inspection",
      [
        { id: "linen", label: "Fresh linen on all beds, no stains or hair?", weight: 2 },
        { id: "beds-made", label: "Beds made to host standard (no creases, pillows aligned)?" },
        { id: "surfaces", label: "Nightstands / dressers / wardrobes wiped, dust-free?" },
        { id: "vacuum", label: "Floor vacuumed / mopped, no streaks?" },
      ],
      { description: "Inspect each bedroom; flag any room individually in notes." }
    ),
    qaSection(
      "bathrooms",
      "Bathrooms — QA Inspection",
      [
        { id: "toilet", label: "Toilet sanitized (seat top + bottom + base + behind)?", weight: 2 },
        { id: "shower", label: "Shower / tub / screen — no soap scum or hair?", weight: 2 },
        { id: "basin-mirror", label: "Basin + mirror streak-free, taps polished?" },
        { id: "stock", label: "Toiletries restocked + fresh towels placed?" },
        { id: "floor", label: "Floor mopped, grout clean?" },
      ]
    ),
    qaSection(
      "kitchen",
      "Kitchen — QA Inspection",
      [
        { id: "surfaces", label: "All surfaces wiped + sanitized (benchtops, splashback)?", weight: 2 },
        { id: "appliances", label: "Appliances cleaned (oven/microwave/fridge exterior, stovetop)?", weight: 2 },
        { id: "sink", label: "Sink + tap polished, dishes put away?" },
        { id: "essentials", label: "Essentials restocked (coffee, tea, dish soap)?" },
        { id: "floor", label: "Floor swept + mopped, no streaks?" },
      ]
    ),
    qaSection(
      "living",
      "Living areas — QA Inspection",
      [
        { id: "surfaces", label: "Surfaces dusted, electronics wiped?" },
        { id: "soft", label: "Cushions / throws arranged to host standard?" },
        { id: "floor", label: "Floor vacuumed / mopped?" },
        { id: "tech", label: "TV / remotes / Wi-Fi notes reset for next guest?" },
      ]
    ),
    qaSection(
      "guest-ready",
      "Guest readiness",
      [
        { id: "smell", label: "Property smells fresh — no chemical, smoke or pet odour?", weight: 2 },
        { id: "presentation", label: "Photo-ready presentation (a host would 5-star this)?", weight: 2 },
        { id: "security", label: "Windows / doors locked, lockbox set, lights off?", weight: 2 },
        { id: "welcome", label: "Welcome touches in place (notes, gifts, restocked basics)?" },
      ],
      { photoMin: 2, description: "Final overview — minimum 2 photos covering the whole property." }
    ),
  ],
});
