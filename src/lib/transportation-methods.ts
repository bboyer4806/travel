/** The icon for each recognized kind of transportation. "route" stands for blank or unrecognized text. */
export type TransportationIcon = "airplane" | "train" | "car" | "bus" | "boat" | "walking" | "bicycle" | "route";

// The approved terms for each icon (TRA-112), matched as complete words or phrases in any capitalization.
const TERMS: ReadonlyArray<readonly [Exclude<TransportationIcon, "route">, readonly string[]]> = [
  ["airplane", ["flight", "airplane", "flying", "air", "jet"]],
  ["train", ["train", "rail", "subway", "tram"]],
  ["car", ["car", "driving", "rental car", "taxi", "rideshare", "road", "uber", "lyft"]],
  ["bus", ["bus", "coach", "shuttle"]],
  ["boat", ["boat", "ferry", "cruise", "ship", "sea", "water"]],
  ["walking", ["walking", "on foot"]],
  ["bicycle", ["bike", "bicycle", "cycling"]],
];

/** Lowercase words: runs of letters, marks and digits. Spaces, hyphens and punctuation separate them. */
function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

const PHRASES = TERMS.flatMap(([icon, terms]) => terms.map((term) => ({ icon, words: words(term) })));

/** The icons for a connection's saved Transportation text: each recognized kind once, in the order entered. */
export function transportationIcons(method: string): TransportationIcon[] {
  const text = words(method);
  const icons: TransportationIcon[] = [];
  text.forEach((_, start) => {
    for (const phrase of PHRASES) {
      if (!icons.includes(phrase.icon) && phrase.words.every((word, offset) => text[start + offset] === word)) icons.push(phrase.icon);
    }
  });
  return icons.length > 0 ? icons : ["route"];
}
