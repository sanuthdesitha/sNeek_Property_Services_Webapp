export type CoverageZone = "standard" | "on_request";

export interface ServiceSuburb {
  slug: string;
  name: string;
  postcode: string;
  coverage: CoverageZone;
  intro: string;
  statsLabel: string;
}

const STANDARD_SUBURBS: Array<[string, string]> = [
  ["parramatta", "2150"],
  ["harris-park", "2150"],
  ["rosehill", "2142"],
  ["westmead", "2145"],
  ["north-parramatta", "2151"],
  ["south-parramatta", "2151"],
  ["granville", "2142"],
  ["merrylands", "2160"],
  ["guildford", "2161"],
  ["auburn", "2144"],
  ["silverwater", "2128"],
  ["rydalmere", "2116"],
  ["ermington", "2115"],
  ["carlingford", "2118"],
  ["epping", "2121"],
  ["eastwood", "2122"],
  ["north-ryde", "2113"],
  ["macquarie-park", "2113"],
  ["ryde", "2112"],
  ["meadowbank", "2114"],
  ["wentworth-point", "2127"],
  ["olympic-park", "2127"],
  ["lidcombe", "2141"],
  ["homebush", "2140"],
  ["homebush-west", "2140"],
  ["strathfield", "2135"],
  ["burwood", "2134"],
  ["ashfield", "2131"],
  ["leichhardt", "2040"],
  ["dulwich-hill", "2203"],
  ["marrickville", "2204"],
  ["newtown", "2042"],
  ["sydney-cbd", "2000"],
  ["pyrmont", "2009"],
  ["surry-hills", "2010"],
  ["zetland", "2017"],
  ["waterloo", "2017"],
  ["chatswood", "2067"],
  ["lane-cove", "2066"],
  ["st-leonards", "2065"],
  ["neutral-bay", "2089"],
  ["baulkham-hills", "2153"],
  ["castle-hill", "2154"],
  ["kellyville", "2155"],
  ["wentworthville", "2145"],
  ["pendle-hill", "2145"],
  ["toongabbie", "2146"],
  ["seven-hills", "2147"],
  ["blacktown", "2148"],
  ["prospect", "2148"],
  ["greystanes", "2145"],
  ["bankstown", "2200"],
  ["canterbury", "2193"],
  ["hurstville", "2220"],
  ["liverpool", "2170"],
  ["penrith", "2750"],
];

const ON_REQUEST_SUBURBS: Array<[string, string]> = [
  ["bondi", "2026"],
  ["coogee", "2034"],
  ["randwick", "2031"],
  ["cronulla", "2230"],
  ["miranda", "2228"],
  ["campbelltown", "2560"],
  ["camden", "2570"],
  ["richmond", "2753"],
  ["hornsby", "2077"],
  ["manly", "2095"],
  ["dee-why", "2099"],
  ["brookvale", "2100"],
  ["mosman", "2088"],
  ["penrith-south", "2750"],
];

function titleCaseFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export const SYDNEY_SERVICE_SUBURBS: ServiceSuburb[] = [
  ...STANDARD_SUBURBS.map(([slug, postcode]) => ({
    slug,
    postcode,
    name: titleCaseFromSlug(slug),
    coverage: "standard" as const,
    intro: `${titleCaseFromSlug(slug)} is within our main Parramatta-led operating area, so standard cleaning, Airbnb turnover, and property-care jobs can usually be scheduled without special travel review.`,
    statsLabel: `Regular coverage around ${titleCaseFromSlug(slug)}`,
  })),
  ...ON_REQUEST_SUBURBS.map(([slug, postcode]) => ({
    slug,
    postcode,
    name: titleCaseFromSlug(slug),
    coverage: "on_request" as const,
    intro: `${titleCaseFromSlug(slug)} is outside our main Parramatta operating radius, but we can still review larger, recurring, or well-planned jobs there on request.`,
    statsLabel: `On-request coverage for ${titleCaseFromSlug(slug)}`,
  })),
].sort((a, b) => a.name.localeCompare(b.name));

export const SYDNEY_SUBURBS = SYDNEY_SERVICE_SUBURBS;

export function findServiceSuburb(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  return (
    SYDNEY_SERVICE_SUBURBS.find(
      (suburb) =>
        suburb.slug === normalized.replace(/\s+/g, "-") ||
        suburb.name.toLowerCase() === normalized ||
        suburb.postcode === normalized
    ) ?? null
  );
}

export function getSydneySuburbBySlug(slug: string) {
  return SYDNEY_SERVICE_SUBURBS.find((suburb) => suburb.slug === slug) ?? null;
}

export function searchServiceSuburbs(query: string, limit = 8) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  return SYDNEY_SERVICE_SUBURBS.filter((suburb) => {
    const slug = suburb.slug.replace(/-/g, " ");
    return (
      suburb.name.toLowerCase().includes(normalized) ||
      slug.includes(normalized) ||
      suburb.postcode.startsWith(normalized)
    );
  }).slice(0, limit);
}
