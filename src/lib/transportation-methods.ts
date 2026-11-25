/** The icon for each recognized kind of transportation. "route" stands for blank or unrecognized text. */
export type TransportationIcon = "airplane" | "train" | "car" | "bus" | "boat" | "walking" | "bicycle" | "route";

// The approved terms for each icon (TRA-112), with the other word forms of TRA-117: plane, fly, railway, drive, ride share
// and walk, and the plural of each term for a vehicle or a ride. Each matches as a complete word or phrase in any
// capitalization.
const TERMS: ReadonlyArray<readonly [Exclude<TransportationIcon, "route">, readonly string[]]> = [
  ["airplane", ["flight", "flights", "airplane", "airplanes", "plane", "planes", "flying", "fly", "air", "jet", "jets"]],
  ["train", ["train", "trains", "rail", "railway", "subway", "subways", "tram", "trams"]],
  ["car", ["car", "cars", "driving", "drive", "rental car", "rental cars", "taxi", "taxis", "rideshare", "rideshares", "ride share", "ride shares", "road", "uber", "ubers", "lyft", "lyfts"]],
  ["bus", ["bus", "buses", "coach", "coaches", "shuttle", "shuttles"]],
  ["boat", ["boat", "boats", "ferry", "ferries", "cruise", "cruises", "ship", "ships", "sea", "water"]],
  ["walking", ["walking", "walk", "on foot"]],
  ["bicycle", ["bike", "bikes", "bicycle", "bicycles", "cycling"]],
];

/**
 * Lowercase words: runs of letters, marks and digits. Spaces, hyphens and punctuation separate them. Packing
 * recommendations match activities' terms the same way (TRA-18).
 */
export function words(text: string): string[] {
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

/**
 * Whether a connection's Transportation text names an airplane, as its airplane icon shows, alone or with other kinds.
 * Only then do its editor and card show its airline and flight number (TRA-147).
 */
export function isFlight(method: string): boolean {
  return transportationIcons(method).includes("airplane");
}
