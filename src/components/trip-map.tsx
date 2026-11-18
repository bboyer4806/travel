"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PlaceLocation } from "@/lib/location-search";
import { journeyPlaceNames, mapLayout, placeRole, type Journey, type MapLayout, type UnmappedPlace } from "@/lib/trip-map";
import { MapLegend } from "./trip-map-symbols";
import styles from "./trip-map.module.css";

// Leaflet needs a browser, so the map itself loads only there.
const TripMapCanvas = dynamic(() => import("./trip-map-canvas"), { ssr: false, loading: () => <p className={styles.message}>Loading the map…</p> });

const reasons: Record<UnmappedPlace["reason"], string> = {
  notAdded: "Not added yet.",
  missing: "No place was found by this name.",
  unavailable: "Couldn't be looked up right now.",
};

/**
 * A trip's Map section (TRA-44), open until it is closed: its departure, destinations, itinerary stops and return on a
 * map, joined in travel order, with the places it can't show listed below. Places are looked up by their saved names
 * whenever the trip's names change, so the map follows every saved change; places already found stay while new ones
 * are looked up.
 */
export default function TripMap({ tripId, journey }: { tripId: string; journey: Journey }) {
  const [expanded, setExpanded] = useState(true);
  const headingId = useId();
  const contentId = useId();
  const names = journeyPlaceNames(journey);
  const namesKey = JSON.stringify(names);
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([tripId, namesKey, attempt]);
  const [known, setKnown] = useState<Record<string, PlaceLocation>>({});
  const [answered, setAnswered] = useState("");
  useEffect(() => {
    const wanted = JSON.parse(namesKey) as string[];
    if (wanted.length === 0) return;
    const controller = new AbortController();
    fetch("/api/trip-map/" + encodeURIComponent(tripId), { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = response.ok ? await response.json() : null;
        if (typeof body?.places !== "object" || body.places === null) throw new Error("Map locations are unavailable.");
        return body.places as Record<string, PlaceLocation>;
      })
      .catch(() => Object.fromEntries(wanted.map((name) => [name, { status: "unavailable" } as PlaceLocation])))
      .then((places) => {
        if (controller.signal.aborted) return;
        // A place found once stays on the map when a later lookup can't be made.
        setKnown((previous) => {
          const next = { ...previous };
          for (const [name, location] of Object.entries(places)) if (location.status !== "unavailable" || next[name]?.status !== "found") next[name] = location;
          return next;
        });
        setAnswered(requestKey);
      });
    return () => controller.abort();
  }, [tripId, namesKey, requestKey]);
  const loading = names.length > 0 && answered !== requestKey;
  // Once answered, a name the answer left out, as when someone else changed the trip meanwhile, couldn't be looked up.
  const locations = loading ? known : Object.fromEntries(names.map((name) => [name, known[name] ?? { status: "unavailable" } as PlaceLocation]));
  const layoutJson = JSON.stringify(mapLayout(journey, locations));
  // The same layout keeps its identity across renders, so the map redraws only when what it shows changes.
  const layout = useMemo(() => JSON.parse(layoutJson) as MapLayout, [layoutJson]);
  const unavailable = layout.unmapped.some((place) => place.reason === "unavailable");

  return <section className={styles.section} aria-labelledby={headingId}>
    <div className="section-heading"><div><p className="eyebrow">THE WHOLE JOURNEY</p>
      <h2 id={headingId}><button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((open) => !open)}>The map<ChevronDown size={22} aria-hidden="true" /></button></h2></div></div>
    <div id={contentId} hidden={!expanded}>
      {expanded && <>
        <div className={styles.frame}>
          {layout.markers.length > 0 ? <TripMapCanvas layout={layout} />
            : <p className={styles.message}>{loading ? "Finding this trip’s places…" : names.length === 0 ? "Add a departing city or a destination to see this trip on the map." : "None of this trip’s places can be shown on the map yet."}</p>}
        </div>
        {layout.markers.length > 0 && <MapLegend layout={layout} />}
        <p className={styles.status} role="status">{loading ? "Finding places on the map…" : ""}</p>
        {layout.unmapped.length > 0 && <div className={styles.unmapped}>
          <h3>Not on the map</h3>
          <p>The map shows a place only when it finds one by that name, and never guesses where a place is. A city chosen from the suggestions, or a name followed by its state or country, is easiest to find. A departure, return or layover written as an airport’s three-letter code in capitals, such as PHL, is shown at that airport.</p>
          <ul>{layout.unmapped.map((place) => <li key={place.key}>
            <span className={styles.role}>{placeRole(place.kind, place.number)}{place.connection && " · " + place.connection}</span>
            <strong>{place.label || "No city"}</strong>
            <span className={styles.reason}>{reasons[place.reason]}</span>
          </li>)}</ul>
          {unavailable && !loading && <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>}
        </div>}
        <p className={styles.credit}>Places found by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>, airports by <a href="https://ourairports.com/" target="_blank" rel="noreferrer">OurAirports</a></p>
      </>}
    </div>
  </section>;
}
