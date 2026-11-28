"use client";

import type { ReactNode } from "react";
import { isFlight } from "@/lib/transportation-methods";
import type { TravelLeg } from "@/lib/types";
import styles from "./connection-flight.module.css";

/*
 * A flight's airline and flight number (TRA-147): in its connection's editor, below Transportation, and on its card in
 * Between the places. Both show only while the connection's transportation names an airplane, and stay saved when it
 * doesn't, so naming a flight again shows them again. The flight's layovers show with them (TRA-184). Its estimated
 * miles required (TRA-186) show the same way, beside its price instead, so the two ways of paying show together.
 */

type FlightLeg = Pick<TravelLeg, "method" | "airline" | "flightNumber">;

/**
 * A connection's Transportation field, with `method` as typed, then its flight while it names an airplane: Airline and
 * Flight number, and below them `layovers`, the editor of the flight's layovers (TRA-184). Hidden, Airline and Flight
 * number keep what they hold, and saving sends it, so changing the transportation never clears them. The layovers then
 * show under Stops along the way instead, so none is hidden from the person editing.
 */
export function TransportationFields({ leg, method, onMethodChange, layovers }: { leg: Pick<TravelLeg, "airline" | "flightNumber">; method: string; onMethodChange: (method: string) => void; layovers: ReactNode }) {
  const flight = isFlight(method);
  return <>
    <label className="field wide"><span>Transportation</span><input name="method" value={method} onChange={(event) => onMethodChange(event.target.value)} maxLength={120} placeholder="Flight, train, rental car…" /><small>Name a flight, such as Flight or Plane, to add its airline and flight number, with its layovers below them.</small></label>
    <div className="wide" hidden={!flight}>
      <div className="form-grid">
        <label className="field"><span>Airline</span><input name="airline" defaultValue={leg.airline} maxLength={120} placeholder="e.g. Delta" /></label>
        <label className="field"><span>Flight number</span><input name="flightNumber" defaultValue={leg.flightNumber} maxLength={120} placeholder="e.g. DL 123" /></label>
      </div>
      {flight && layovers}
    </div>
  </>;
}

/**
 * A flight's Estimated miles required (TRA-186), which its connection's editor shows directly below Estimated price (USD).
 * It is the whole party's airline miles for the whole connection, a whole number, or blank when unknown, and the trip
 * estimate never counts it. Like Airline and Flight number, it shows only while `method` names an airplane, so changing
 * the transportation never clears it. Hidden, it is also disabled, so a save leaves it out, which keeps the saved number,
 * and nothing typed in it can stop the save, as a hidden field the browser finds invalid would, without saying why.
 */
export function FlightMilesField({ leg, method }: { leg: Pick<TravelLeg, "milesRequired">; method: string }) {
  const flight = isFlight(method);
  return <div className="wide" hidden={!flight}>
    <label className="field"><span>Estimated miles required</span><input name="milesRequired" type="number" inputMode="numeric" className="no-spin-buttons" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={leg.milesRequired ?? ""} placeholder="Not estimated" disabled={!flight} /><small>Airline miles instead of the price: the total for the whole party for the full connection, including layovers. The trip estimate counts only the price. Leave blank if unknown.</small></label>
  </div>;
}

/** A flight's estimated miles on its card, below its price, once entered, such as 125,000 miles required (TRA-186). A connection that isn't a flight shows none. */
export function FlightMiles({ leg }: { leg: Pick<TravelLeg, "method" | "milesRequired"> }) {
  if (!isFlight(leg.method) || leg.milesRequired === null) return null;
  return <span className="price">{`${leg.milesRequired.toLocaleString("en-US")} ${leg.milesRequired === 1 ? "mile" : "miles"} required`}</span>;
}

/** A flight's airline and flight number on its card, each only once entered. A connection that isn't a flight shows neither. */
export function FlightDetails({ leg }: { leg: FlightLeg }) {
  if (!isFlight(leg.method) || (!leg.airline && !leg.flightNumber)) return null;
  return <dl className={styles.details}>
    {leg.airline && <div><dt>Airline</dt><dd>{leg.airline}</dd></div>}
    {leg.flightNumber && <div><dt>Flight number</dt><dd>{leg.flightNumber}</dd></div>}
  </dl>;
}
