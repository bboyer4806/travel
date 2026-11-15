import { Flag, House, MapPin, Plane } from "lucide-react";
import { TransportationIcons } from "@/components/transportation-icons";
import type { MapLayout, MapMarker } from "@/lib/trip-map";
import styles from "./trip-map.module.css";

/** How a trip's map draws each kind of place: destinations numbered as on their cards, and the trip's ends, layovers and stops by symbol. */
export function MarkerSymbol({ kind, number }: { kind: MapMarker["kind"]; number: number | null }) {
  if (kind === "destination") return <span className={styles.destination}>{String(number).padStart(2, "0")}</span>;
  if (kind === "layover") return <span className={styles.layover}><Plane size={12} strokeWidth={2.2} /></span>;
  if (kind === "stop") return <span className={styles.stop}><MapPin size={12} strokeWidth={2.2} /></span>;
  return <span className={styles.endpoint}>{kind === "return" ? <Flag size={14} strokeWidth={2.2} /> : <House size={14} strokeWidth={2.2} />}</span>;
}

/** A connection's transportation on the map, with the icons its card shows. */
export function TransportationBadge({ method }: { method: string }) {
  return <span className={styles.badge}><TransportationIcons method={method} size={13} className={styles.badgeIcons} /></span>;
}

const entries: [MapMarker["kind"], string][] = [["roundTrip", "Departure and return"], ["departure", "Departure"], ["destination", "Destination"], ["layover", "Layover"], ["stop", "Stop along the way"], ["return", "Return"]];

/** The key below the map, for the kinds of places and lines it shows. */
export function MapLegend({ layout }: { layout: MapLayout }) {
  const kinds = new Set(layout.markers.map((marker) => marker.kind));
  return <ul className={styles.legend} aria-label="Map key">
    {entries.filter(([kind]) => kinds.has(kind)).map(([kind, label]) => <li key={kind}><span className={styles.legendSymbol} aria-hidden="true"><MarkerSymbol kind={kind} number={1} /></span>{label}</li>)}
    {layout.lines.length > 0 && <li><span className={styles.legendSymbol} aria-hidden="true"><TransportationBadge method="" /></span>Transportation</li>}
  </ul>;
}
