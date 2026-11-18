import { comparable, describes } from "./destination-label.ts";
import type { LocationSuggestion } from "./location-search.ts";
import type { LibraryDestination } from "./types.ts";

/** A city as written: its name, the text before its first comma, and the regions and country written after it. */
function cityParts(city: string): { name: string; qualifiers: string[] } {
  const [name = "", ...qualifiers] = city.split(",").map((part) => part.trim());
  return { name, qualifiers: qualifiers.filter(Boolean) };
}

/**
 * Whether a city suggestion is a saved destination (TRA-142): a place of the destination's name, ignoring letter case,
 * accents and punctuation, in every region and country written after it, by name, ISO code or US state abbreviation. So
 * "Reykjavik, Iceland" is Reykjavík in Capital Region, Iceland, and "Nuuk, GL" is Nuuk in Sermersooq, Greenland, while
 * "Newport, Wales, United Kingdom" isn't Newport in England. A city saved without a region or country, such as
 * "Paris", could be any place of its name, so no suggestion is it.
 */
function isSavedDestination(suggestion: LocationSuggestion, destination: LibraryDestination): boolean {
  const { name, qualifiers } = cityParts(destination.city);
  const place = { region: suggestion.region, areas: [suggestion.region, suggestion.country].filter(Boolean), countryCode: suggestion.countryCode };
  return qualifiers.length > 0 && comparable(name) === comparable(suggestion.name) && qualifiers.every((qualifier) => describes(qualifier, place));
}

/**
 * Add destination's search (TRA-142): the saved destinations to offer for what was typed, each once, in the library's
 * order, and the city suggestions left once those are offered. A saved destination is offered when its name begins with
 * the name typed, the text before any comma, ignoring letter case, accents and punctuation, or when a suggestion is it,
 * which it replaces.
 */
export function searchLibrary(library: readonly LibraryDestination[], query: string, suggestions: readonly LocationSuggestion[]): { destinations: LibraryDestination[]; suggestions: LocationSuggestion[] } {
  const typed = comparable(cityParts(query).name);
  const destinations = library.filter((destination) => (typed !== "" && comparable(cityParts(destination.city).name).startsWith(typed))
    || suggestions.some((suggestion) => isSavedDestination(suggestion, destination)));
  return { destinations, suggestions: suggestions.filter((suggestion) => !destinations.some((destination) => isSavedDestination(suggestion, destination))) };
}
