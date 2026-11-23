"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatSavedDestinationLabel } from "@/lib/destination-label";
import { destinationMapLayout, lookupText, MAP_CATEGORIES, MAP_CATEGORY_LABELS, placeKey, type DestinationMapAnswer, type DestinationMapLayout, type MapCategory, type SavedPlace, type UnmappedPlace } from "@/lib/destination-map";
import type { PlaceAnswer } from "@/lib/place-search";
import type { Destination } from "@/lib/types";
import { PlaceSymbol } from "./destination-map-symbols";
import styles from "./destination-map.module.css";

// Leaflet needs a browser, so the map itself loads only there.
const DestinationMapCanvas = dynamic(() => import("./destination-map-canvas"), { ssr: false, loading: () => <p className={styles.message}>Loading the map…</p> });

/** Why its lookup didn't place a place. */
function lookupReason(place: UnmappedPlace): string {
  switch (place.reason) {
    case "missing": return place.address.trim() ? "No place nearby has its address or name." : "No place nearby has this name.";
    case "ambiguous": return "More than one place nearby matches.";
    case "unavailable": return "Couldn't be looked up right now.";
  }
}

/**
 * Why Not on the map lists a place: that its saved coordinates wait to be reviewed (TRA-150), and its lookup's answer,
 * which the paragraph above says for every place when the destination itself can't be found.
 */
function reason(place: UnmappedPlace, areaMissing: boolean): string {
  return [place.coordinates?.review ? "Its address changed after its coordinates were saved, so they wait to be checked in its editor." : "", areaMissing ? "" : lookupReason(place)].filter(Boolean).join(" ");
}

/**
 * A destination's Map section (TRA-130), open until it is closed: its saved hotels, activities, restaurants and churches,
 * selected or not, on a map, with the places it can't show listed below it by category. Checkboxes choose the categories
 * both show. Places are looked up by their saved addresses and names whenever those or the destination's city change,
 * so the map follows every saved change; places already found stay while new ones are looked up. A place with saved
 * coordinates is looked up by its address alone, and shows at its coordinates, marked when they are approximate, when its
 * address isn't found, or at once without an address (TRA-163). Places waiting their turn are asked for again until every
 * one is answered. View details opens a place's details.
 */
export default function DestinationMap({ destination, places, onView }: { destination: Pick<Destination, "id" | "city" | "cityFromSuggestion">; places: SavedPlace[]; onView: (place: SavedPlace) => void }) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const [shown, setShown] = useState<readonly MapCategory[]>(MAP_CATEGORIES);
  const city = formatSavedDestinationLabel(destination);
  // Every place but one with coordinates to show it at and no address is looked up (TRA-163).
  const lookups = places.filter((place) => lookupText(place) !== null);
  const keysJson = JSON.stringify(lookups.map((place) => [place.id, placeKey(destination.city, place)]));
  // Try again, and each request for places still waiting their turn.
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([destination.id, keysJson, attempt]);
  const [known, setKnown] = useState<DestinationMapAnswer["places"]>({});
  const [area, setArea] = useState<DestinationMapAnswer["area"]>("found");
  const [answered, setAnswered] = useState("");
  useEffect(() => {
    const wanted = JSON.parse(keysJson) as [string, string][];
    if (wanted.length === 0) return;
    const controller = new AbortController();
    fetch("/api/destination-map/" + encodeURIComponent(destination.id), { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = response.ok ? await response.json() : null;
        if (typeof body?.places !== "object" || body.places === null) throw new Error("Map locations are unavailable.");
        return body as DestinationMapAnswer;
      })
      .catch((): DestinationMapAnswer => ({ area: "unavailable", places: Object.fromEntries(wanted.map(([id, key]) => [id, { key, status: "unavailable" }])) }))
      .then((answer) => {
        if (controller.signal.aborted) return;
        // A place found once stays on the map while a later lookup of the same text waits or can't be made.
        setKnown((previous) => {
          const next = { ...previous };
          for (const [id, place] of Object.entries(answer.places)) {
            const kept = previous[id];
            if ((place.status === "pending" || place.status === "unavailable") && kept?.status === "found" && kept.key === place.key) continue;
            next[id] = place;
          }
          return next;
        });
        setArea(answer.area);
        // The server waits a few seconds for places before answering, so those still waiting are asked for at once.
        if (Object.values(answer.places).some((place) => place.status === "pending")) setAttempt((value) => value + 1);
        else setAnswered(requestKey);
      });
    return () => controller.abort();
  }, [destination.id, keysJson, requestKey]);
  const loading = lookups.length > 0 && answered !== requestKey;
  // Once answered, a place the answer left out, or answered for other text, as when someone changed it meanwhile, couldn't be looked up.
  const answers = Object.fromEntries(lookups.map((place): [string, PlaceAnswer | undefined] => {
    const answer = known[place.id];
    return [place.id, answer?.key === placeKey(destination.city, place) ? answer : loading ? undefined : { status: "unavailable" }];
  }));
  const layoutJson = JSON.stringify(destinationMapLayout(places, answers, shown));
  // The same layout keeps its identity across renders, so the map redraws only when what it shows changes.
  const layout = useMemo(() => JSON.parse(layoutJson) as DestinationMapLayout, [layoutJson]);
  const unavailable = layout.unmapped.some((group) => group.places.some((place) => place.reason === "unavailable"));
  const approximate = layout.markers.some((marker) => marker.places.some((place) => place.approximate));
  const selected = places.filter((place) => shown.includes(place.category));
  const toggle = (category: MapCategory) => setShown((current) => MAP_CATEGORIES.filter((item) => item === category ? !current.includes(item) : current.includes(item)));
  const empty = places.length === 0 ? "Save a hotel, activity, restaurant or church for " + city + " to see it on the map."
    : selected.length === 0 ? (shown.length === 0 ? "Select a category to see its places on the map." : "Nothing is saved in the selected categories.")
    : loading ? "Finding " + city + "’s places…"
    : area === "missing" ? "The map can’t find " + city + " itself, so it can’t look up its places."
    : "None of the selected places can be shown on the map yet.";

  return <section className={styles.section} aria-label={"Map of " + city}>
    <div className="budget-section-heading"><h4><button type="button" className="budget-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((open) => !open)}>Map<ChevronDown size={18} aria-hidden="true" /></button></h4></div>
    <div id={contentId} hidden={!expanded}>
      {expanded && <>
        <fieldset className={styles.filters}>
          <legend className="sr-only">Show on the map</legend>
          {MAP_CATEGORIES.map((category) => <label key={category} className={styles.filter}>
            <input type="checkbox" checked={shown.includes(category)} onChange={() => toggle(category)} />
            <span aria-hidden="true"><PlaceSymbol category={category} /></span>{MAP_CATEGORY_LABELS[category]}
          </label>)}
        </fieldset>
        <div className={styles.frame}>
          {layout.markers.length > 0 ? <DestinationMapCanvas markers={layout.markers} onView={onView} /> : <p className={styles.message}>{empty}</p>}
        </div>
        {approximate && <p className={styles.note}><span className={styles.key} aria-hidden="true" />A dashed ring marks a place shown at approximate coordinates, not at a verified address.</p>}
        <p className={styles.status} role="status">{loading ? "Finding places on the map…" : ""}</p>
        {layout.unmapped.length > 0 && <div className={styles.unmapped}>
          <h5>Not on the map</h5>
          <p>{area === "missing" ? "The map finds places around " + city + ", and can’t find " + city + " itself. A city chosen from the suggestions, or a name followed by its state or country, is easiest to find. A place with coordinates saved in its editor shows without it."
            : "The map never guesses where a place is. It looks each place up by its address, or by its name when it has no address or no place has it, and shows it only when one place within 50 km of " + city + " matches. An address with its street and number is easiest to find, or save the place’s coordinates in its editor to show it there."}</p>
          {layout.unmapped.map((group) => <div key={group.category}>
            <h6>{MAP_CATEGORY_LABELS[group.category]}</h6>
            <ul>{group.places.map((place) => { const why = reason(place, area === "missing"); return <li key={place.id}>
              <span className={styles.place}><strong>{place.name}</strong>{why && <span className={styles.reason}>{why}</span>}</span>
              <button type="button" className="text-button" onClick={() => onView(place)}>View details<span className="sr-only"> for {place.name}</span></button>
            </li>; })}</ul>
          </div>)}
          {unavailable && !loading && <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>}
        </div>}
        <p className={styles.credit}>Places found by <a href="https://nominatim.org/" target="_blank" rel="noreferrer">Nominatim</a> from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> data, and {city} by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></p>
      </>}
    </div>
  </section>;
}
