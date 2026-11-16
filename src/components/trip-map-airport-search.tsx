"use client";

import { useEffect, useState } from "react";
import { Plane, Search } from "lucide-react";
import type { LocationSuggestion } from "@/lib/location-search";
import type { Position } from "@/lib/trip-map";
import styles from "./trip-map.module.css";

type Found = { code: string; airport: LocationSuggestion | null; failed?: boolean };

/**
 * The trip map's airport search (TRA-132): an airport's three-letter IATA code, in any letter case, finds that airport
 * anywhere in the world through the location search's `code`. Selecting it centers the map there; typing alone never
 * moves the map, and nothing is saved.
 */
export default function TripMapAirportSearch({ onSelect }: { onSelect: (position: Position) => void }) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [centered, setCentered] = useState("");
  const isCode = /^[a-z]{3}$/i.test(text.trim());
  const code = text.trim().toUpperCase();

  useEffect(() => {
    if (!isCode) return;
    const controller = new AbortController();
    fetch(`/api/locations?code=${encodeURIComponent(code)}`, { signal: controller.signal })
      .then(async (response): Promise<Found> => {
        const body = response.ok ? await response.json() : null;
        if (!Array.isArray(body?.locations)) throw new Error("Airport search is unavailable.");
        return { code, airport: (body.locations as LocationSuggestion[])[0] ?? null };
      })
      .catch((): Found => ({ code, airport: null, failed: true }))
      .then((result) => { if (!controller.signal.aborted) setFound(result); });
    return () => controller.abort();
  }, [code, isCode]);

  const current = isCode && found?.code === code ? found : null;
  const airport = current?.airport;
  const position = airport?.airport;
  const status = !text.trim() ? "" : !isCode ? "Enter an airport’s three-letter code." : !current ? "Finding the airport…"
    : current.failed ? "Airport search is unavailable right now." : !airport ? `No airport has the code ${code}.`
    : centered === code ? `The map is centered on ${airport.name}.` : `Found ${airport.name}. Select it to center the map.`;

  return <div className={styles.airportSearch}>
    <label className="search-field"><Search size={17} aria-hidden="true" />
      <input aria-label="Find an airport by its code" value={text} placeholder="Airport code, e.g. CLE" autoComplete="off" autoCapitalize="characters" spellCheck={false}
        onChange={(event) => { setText(event.target.value); setCentered(""); }} />
    </label>
    {airport && position && <button type="button" className={styles.airport} onClick={() => {
      // A new position each time, so selecting the airport again centers the map on it again.
      onSelect([position.latitude, position.longitude]);
      setCentered(code);
    }}>
      <Plane size={16} aria-hidden="true" /><span><strong>{airport.name}</strong><small>{[airport.region, airport.country].filter(Boolean).join(", ")}</small></span>
    </button>}
    {!airport && status && <p className={styles.airportMessage} aria-hidden="true">{status}</p>}
    <span className="sr-only" role="status" aria-live="polite">{status}</span>
  </div>;
}
