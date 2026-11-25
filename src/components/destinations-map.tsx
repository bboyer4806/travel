"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { destinationHref, destinationsMapLayout, lookupCity, type DestinationLocation, type DestinationsMapAnswer, type DestinationsMapLayout, type MapDestination, type UnmappedDestination } from "@/lib/destinations-map";
import type { PlaceLocation } from "@/lib/location-search";
import styles from "./destinations-map.module.css";

// Leaflet needs a browser, so the map itself loads only there.
const DestinationsMapCanvas = dynamic(() => import("./destinations-map-canvas"), { ssr: false, loading: () => <p className={styles.message}>Loading the map…</p> });

const reasons: Record<UnmappedDestination["reason"], string> = {
  missing: "No place was found by this name.",
  unavailable: "Couldn't be looked up right now.",
};

/**
 * The Destinations page's Map section (TRA-180), open until it is closed: every saved destination the account can open,
 * each once, on one map, with those it can't show listed below it with links to their pages. `shown` are the IDs of the
 * destinations the page's search shows, which both show. Destinations are looked up by their saved cities whenever a
 * destination is added, renamed or removed, so the map follows saved changes; searching looks nothing up, and
 * destinations already found stay while new ones are looked up.
 */
export default function DestinationsMap({ destinations, shown }: { destinations: MapDestination[]; shown: string[] }) {
  const [expanded, setExpanded] = useState(true);
  const headingId = useId();
  const contentId = useId();
  const keysJson = JSON.stringify(destinations.map((item) => [item.id, lookupCity(item)]));
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([keysJson, attempt]);
  const [known, setKnown] = useState<Record<string, DestinationLocation>>({});
  const [answered, setAnswered] = useState("");
  useEffect(() => {
    const wanted = JSON.parse(keysJson) as [string, string][];
    if (wanted.length === 0) return;
    const controller = new AbortController();
    fetch("/api/destinations-map", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = response.ok ? await response.json() : null;
        if (typeof body?.destinations !== "object" || body.destinations === null) throw new Error("Map locations are unavailable.");
        return (body as DestinationsMapAnswer).destinations;
      })
      .catch(() => Object.fromEntries(wanted.map(([id, city]): [string, DestinationLocation] => [id, { status: "unavailable", city }])))
      .then((found) => {
        if (controller.signal.aborted) return;
        // A destination found once stays on the map when a later lookup of the same city can't be made.
        setKnown((previous) => {
          const next = { ...previous };
          for (const [id, location] of Object.entries(found)) {
            const kept = previous[id];
            if (location.status === "unavailable" && kept?.status === "found" && kept.city === location.city) continue;
            next[id] = location;
          }
          return next;
        });
        setAnswered(requestKey);
      });
    return () => controller.abort();
  }, [keysJson, requestKey]);
  const loading = destinations.length > 0 && answered !== requestKey;
  // Once answered, a destination the answer left out, or answered for another city, as when someone renamed it meanwhile,
  // couldn't be looked up.
  const locations = Object.fromEntries(destinations.map((item): [string, PlaceLocation | undefined] => {
    const answer = known[item.id];
    return [item.id, answer?.city === lookupCity(item) ? answer : loading ? undefined : { status: "unavailable" }];
  }));
  const layoutJson = JSON.stringify(destinationsMapLayout(destinations, shown, locations));
  // The same layout keeps its identity across renders, so the map redraws only when what it shows changes.
  const layout = useMemo(() => JSON.parse(layoutJson) as DestinationsMapLayout, [layoutJson]);
  const unavailable = layout.unmapped.some((item) => item.reason === "unavailable");
  const empty = destinations.length === 0 ? "Add a destination to see it on the map."
    : shown.length === 0 ? "No destinations match that search."
    : loading ? "Finding your destinations…"
    : "None of these destinations can be shown on the map yet.";

  return <section className={styles.section} aria-labelledby={headingId}>
    <h3 id={headingId} className={styles.heading}><button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((open) => !open)}>Map<ChevronDown size={20} aria-hidden="true" /></button></h3>
    <div id={contentId} hidden={!expanded}>
      {expanded && <>
        <div className={styles.frame}>
          {layout.mapped.length > 0 ? <DestinationsMapCanvas destinations={layout.mapped} /> : <p className={styles.message}>{empty}</p>}
        </div>
        <p className={styles.status} role="status">{loading ? "Finding destinations on the map…" : ""}</p>
        {layout.unmapped.length > 0 && <div className={styles.unmapped}>
          <h4>Not on the map</h4>
          <p>The map shows a destination only when it finds a place by its city’s name, and never guesses where one is. A city chosen from the suggestions, or a name followed by its state or country, is easiest to find.</p>
          <ul>{layout.unmapped.map((item) => <li key={item.id}>
            <Link href={destinationHref(item.id)}>{item.name}</Link>
            <span className={styles.reason}>{reasons[item.reason]}</span>
          </li>)}</ul>
          {unavailable && !loading && <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>}
        </div>}
        <p className={styles.credit}>Places found by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></p>
      </>}
    </div>
  </section>;
}
